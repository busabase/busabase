import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitPayloadWithFields } from "../src/domains/base/logic/commit-payload-projection";

describe("commit payload projection against PostgreSQL via PGlite", () => {
  let pg: PGlite;
  const dialect = new PgDialect();

  beforeAll(async () => {
    pg = await PGlite.create();
  });

  afterAll(async () => {
    await pg?.close();
  });

  const project = async (payload: Record<string, unknown>, slugs: Iterable<string>) => {
    // Execute the production SQL expression against a commit-shaped row without
    // bringing unrelated application migrations or router setup into this test.
    const query = dialect.sqlToQuery(sql`
      select ${commitPayloadWithFields(slugs)} as projected
      from (select ${JSON.stringify(payload)}::jsonb as payload) as busabase_commits
    `);
    const result = await pg.query<{ projected: Record<string, unknown> }>(query.sql, query.params);
    return result.rows[0]?.projected;
  };

  it("preserves every JSON value type, including explicit null, while omitting missing keys", async () => {
    const selected = {
      text: "example",
      number: 1.25,
      enabled: true,
      disabled: false,
      emptyText: "",
      zero: 0,
      nothing: null,
      array: [1, null, { nested: false }],
      object: { nested: ["kept", null] },
    };
    const payload = { ...selected, unrelated: { body: "large sibling ".repeat(100_000) } };
    expect(await project(payload, [...Object.keys(selected), "missing"])).toEqual(selected);
    for (const [key, value] of Object.entries(selected)) {
      expect(await project(payload, [key])).toEqual({ [key]: value });
    }
  });

  it("returns an empty object for an empty request, missing keys, or an empty payload", async () => {
    expect(await project({ name: "kept" }, [])).toEqual({});
    expect(await project({ name: "kept" }, ["missing"])).toEqual({});
    expect(await project({}, ["name", "missing"])).toEqual({});
  });

  it("handles empty and hostile slugs as literal keys, deduplicates them, and accepts iterables", async () => {
    const selected = Object.fromEntries([
      ["", "empty key"],
      ["name'); drop table busabase_commits; --", "SQL text"],
      ['quote"\\line\nbreak', "escaped key"],
      ["a.b[0]", "literal path"],
      ["__proto__", { safe: true }],
      ["中文😀", null],
    ]);
    function* slugs() {
      yield* Object.keys(selected);
      yield "";
      yield "__proto__";
      yield "missing'); select pg_sleep(60); --";
    }
    expect(await project({ ...selected, unrelated: "omit" }, slugs())).toEqual(selected);
    for (const [key, value] of Object.entries(selected)) {
      expect(await project({ ...selected, unrelated: "omit" }, [key, key])).toEqual({
        [key]: value,
      });
    }
  });

  it("avoids expansion for one unique key but expands only once for multiple keys", () => {
    // Repeated requested-key extraction detoasts a large payload for every key;
    // the multi-field path must keep the one-expansion strategy.
    const single = dialect.sqlToQuery(commitPayloadWithFields(["name", "name"]));
    expect(single.sql).not.toContain("jsonb_each");
    expect(single.sql).toContain("offset 0");
    expect(single.params).toEqual(["name", "name"]);
    const multiple = dialect.sqlToQuery(commitPayloadWithFields(["name", "status"]));
    expect(multiple.sql.match(/jsonb_each/g)).toHaveLength(1);
    expect(multiple.params).toEqual(["name", "status"]);
  });

  it.each([51, 101, 150])(
    "supports %i requested fields without SQL function argument limits",
    async (count) => {
      const selected = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`field_${index}`, index % 3 ? index : null]),
      );
      expect(
        await project({ ...selected, unrelated: "omit" }, [...Object.keys(selected), "missing"]),
      ).toEqual(selected);
    },
  );
});
