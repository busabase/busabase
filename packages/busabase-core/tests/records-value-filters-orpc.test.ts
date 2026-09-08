import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `valueFilters` compare a record's STORED value in its typed column, which is
 * a different contract from the view `filters` alongside them:
 *
 * - view filters are a SUPERSET the client narrows, because their authority is
 *   `recordMatchesViewFilter` comparing rendered preview text;
 * - value filters are EXACT, because each admitted family compares the column
 *   that holds the value itself — `value_number`, `value_date`, `value_bool`,
 *   and `value_text` for the equality cases where truncation provably cannot
 *   change the answer.
 *
 * Exactness is the entire product here, so every case below is checked twice:
 * against a hand-written expectation, and against the same comparison done in
 * plain JS over the full record set. A hand count can be wrong in the same
 * direction as the code; a parity check alone can pass with both sides wrong
 * together. Both must agree.
 *
 * The seed carries the shapes that break a careless implementation: a record
 * with the field ABSENT (must not match a comparison OR its negation, the way
 * SQL drops NULL from both), zero and negatives (a truthiness check would lose
 * them), and duplicate values (an off-by-one in the boundary operators shows up
 * as a changed count).
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

interface Seed {
  name: string;
  score?: number;
  due?: string;
  tag?: string;
  done?: boolean;
}

const SEED: Seed[] = [
  { name: "alpha", score: 90, due: "2026-01-10T00:00:00.000Z", tag: "red", done: true },
  { name: "bravo", score: 0, due: "2026-02-20T00:00:00.000Z", tag: "blue", done: false },
  { name: "charlie", score: -5, due: "2026-03-30T00:00:00.000Z", tag: "red", done: false },
  { name: "delta", score: 42, due: "2026-04-15T00:00:00.000Z", tag: "green", done: true },
  { name: "echo", score: 42, due: "2026-05-01T00:00:00.000Z", tag: "blue", done: true },
  // No score, no due, no tag, no done — the absent-field case, which must fall
  // out of a comparison AND its negation, for every family.
  { name: "foxtrot" },
];

describe("records.list valueFilters", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-value-filters-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-value-filters-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "scores",
      name: "Scores",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
        { slug: "due", name: "Due", type: "date", required: false, options: {} },
        {
          slug: "tag",
          name: "Tag",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "c1", name: "red" },
              { id: "c2", name: "blue" },
              { id: "c3", name: "green" },
            ],
          },
        },
        { slug: "done", name: "Done", type: "checkbox", required: false, options: {} },
        { slug: "blob", name: "Blob", type: "json", required: false, options: {} },
        { slug: "made", name: "Made", type: "created_time", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    for (const row of SEED) {
      await client.bases.createChangeRequest({
        baseId,
        fields: { ...row },
        message: `seed ${row.name}`,
        autoMerge: true,
      });
    }
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const namesFrom = (page: { records: { headCommit: { payload: Record<string, unknown> } }[] }) =>
    page.records.map((r) => String(r.headCommit.payload.name)).sort();

  /** The same comparison, done in plain JS over the seed — the parity oracle. */
  const expectedNames = (predicate: (row: Seed) => boolean) =>
    SEED.filter(predicate)
      .map((row) => row.name)
      .sort();

  const query = async (valueFilters: unknown[]) =>
    client.records.list({ baseId, limit: 100, valueFilters } as never);

  it.each([
    ["gt", 42, (row: Seed) => row.score !== undefined && row.score > 42, ["alpha"]],
    [
      "gte",
      42,
      (row: Seed) => row.score !== undefined && row.score >= 42,
      ["alpha", "delta", "echo"],
    ],
    ["lt", 42, (row: Seed) => row.score !== undefined && row.score < 42, ["bravo", "charlie"]],
    [
      "lte",
      42,
      (row: Seed) => row.score !== undefined && row.score <= 42,
      ["bravo", "charlie", "delta", "echo"],
    ],
    ["eq", 42, (row: Seed) => row.score !== undefined && row.score === 42, ["delta", "echo"]],
    [
      "ne",
      42,
      (row: Seed) => row.score !== undefined && row.score !== 42,
      ["alpha", "bravo", "charlie"],
    ],
  ])("number %s", async (operator, value, predicate, handWritten) => {
    const page = await query([{ fieldSlug: "score", operator, value }]);
    expect(namesFrom(page)).toEqual(handWritten);
    expect(namesFrom(page)).toEqual(expectedNames(predicate));
  });

  it("keeps zero and negative numbers, which a truthiness check would drop", async () => {
    const page = await query([{ fieldSlug: "score", operator: "lte", value: 0 }]);
    expect(namesFrom(page)).toEqual(["bravo", "charlie"]);
  });

  it("excludes an absent field from a comparison AND from its negation", async () => {
    // SQL drops NULL from both sides; "foxtrot" has no score at all, so it must
    // appear in neither. Getting this wrong is invisible on the positive case.
    const gt = await query([{ fieldSlug: "score", operator: "gt", value: -1000 }]);
    const ne = await query([{ fieldSlug: "score", operator: "ne", value: -1000 }]);
    expect(namesFrom(gt)).not.toContain("foxtrot");
    expect(namesFrom(ne)).not.toContain("foxtrot");
  });

  it("compares date fields chronologically", async () => {
    const page = await query([
      { fieldSlug: "due", operator: "gte", value: "2026-04-01T00:00:00.000Z" },
    ]);
    expect(namesFrom(page)).toEqual(["delta", "echo"]);
    expect(namesFrom(page)).toEqual(
      expectedNames((row) => row.due !== undefined && row.due >= "2026-04-01T00:00:00.000Z"),
    );
  });

  it("ANDs multiple value filters", async () => {
    const page = await query([
      { fieldSlug: "score", operator: "gte", value: 0 },
      { fieldSlug: "score", operator: "lt", value: 42 },
    ]);
    expect(namesFrom(page)).toEqual(["bravo"]);
  });

  it("is exact enough to page against — limit returns a full page, not a short one", async () => {
    // This is what exactness buys. Under a superset filter the server's extra
    // rows would eat the limit budget and this would come back short.
    const page = await client.records.list({
      baseId,
      limit: 2,
      valueFilters: [{ fieldSlug: "score", operator: "lte", value: 42 }],
    } as never);
    expect(page.records).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("ANDs with view filters when both are given", async () => {
    const page = await client.records.list({
      baseId,
      limit: 100,
      filters: [{ fieldSlug: "name", fieldType: "text", operator: "equals", value: "delta" }],
      valueFilters: [{ fieldSlug: "score", operator: "eq", value: 42 }],
    } as never);
    expect(namesFrom(page)).toEqual(["delta"]);
  });

  describe("text-like families compare value_text, for equality only", () => {
    it.each([
      ["eq", "delta", (row: Seed) => row.name === "delta"],
      ["ne", "delta", (row: Seed) => row.name !== "delta"],
    ])("text %s", async (operator, value, predicate) => {
      const page = await query([{ fieldSlug: "name", operator, value }]);
      expect(namesFrom(page)).toEqual(expectedNames(predicate));
    });

    it("compares a select by its stored choice string", async () => {
      // `select` is excluded from the VIEW filter push-down because that path
      // compares a choice's rendered label. A value filter compares the stored
      // string, which is exactly what the record payload hands the caller — so
      // the two agree here where they would not there.
      const page = await query([{ fieldSlug: "tag", operator: "eq", value: "red" }]);
      expect(namesFrom(page)).toEqual(expectedNames((row) => row.tag === "red"));
      expect(namesFrom(page)).toEqual(["alpha", "charlie"]);
    });

    it("excludes an absent text field from equality AND inequality", async () => {
      const ne = await query([{ fieldSlug: "tag", operator: "ne", value: "red" }]);
      expect(namesFrom(ne)).not.toContain("foxtrot");
      expect(namesFrom(ne)).toEqual(["bravo", "echo", "delta"].sort());
    });
  });

  describe("checkbox compares value_bool", () => {
    it.each([
      [true, ["alpha", "delta", "echo"]],
      [false, ["bravo", "charlie"]],
    ])("eq %s", async (value, expectedRows) => {
      const page = await query([{ fieldSlug: "done", operator: "eq", value }]);
      expect(namesFrom(page)).toEqual(expectedRows.sort());
    });

    it.each([
      ["true", ["alpha", "delta", "echo"]],
      ["false", ["bravo", "charlie"]],
    ])("accepts the query-string spelling %s", async (value, expectedRows) => {
      // `records.list` is a GET, so a caller sending a real boolean gets a
      // STRING on the wire and the schema cannot tell it from a text value.
      // Refusing it made checkbox filters work in-process and 400 over REST —
      // including from the SDK, which is itself an OpenAPI client.
      const page = await query([{ fieldSlug: "done", operator: "eq", value }]);
      expect(namesFrom(page)).toEqual(expectedRows.sort());
    });

    it("does NOT fold an unset checkbox in with false, unlike a view filter", async () => {
      // `recordMatchesViewFilter` treats unset as false because that is what the
      // grid shows. SQL says NULL never equals FALSE, and the caller's own local
      // predicate says the same, so a VALUE filter must not fold them together.
      const page = await query([{ fieldSlug: "done", operator: "eq", value: false }]);
      expect(namesFrom(page)).not.toContain("foxtrot");
    });
  });

  it("compares created_time, which shares the plain date projection", async () => {
    // Admitted alongside `date` because it is COMPUTED at commit time but then
    // flows through the same projection into value_date. That is an inherited
    // claim from `DATE_RANGE_FIELD_TYPES`, so it is checked against a real
    // written record rather than trusted: every seed row was created during
    // this run, so a floor an hour in the past must return all of them and a
    // ceiling an hour in the past must return none.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const after = await query([{ fieldSlug: "made", operator: "gte", value: hourAgo }]);
    const before = await query([{ fieldSlug: "made", operator: "lt", value: hourAgo }]);
    expect(namesFrom(after)).toEqual(SEED.map((row) => row.name).sort());
    expect(namesFrom(before)).toEqual([]);
  });

  describe("`any` groups make the list a CNF", () => {
    it("ORs the branches of a single group", async () => {
      const page = await query([
        {
          any: [
            { fieldSlug: "score", operator: "eq", value: 90 },
            { fieldSlug: "score", operator: "eq", value: 0 },
          ],
        },
      ]);
      expect(namesFrom(page)).toEqual(expectedNames((row) => row.score === 90 || row.score === 0));
      expect(namesFrom(page)).toEqual(["alpha", "bravo"]);
    });

    it("ORs across DIFFERENT fields", async () => {
      const page = await query([
        {
          any: [
            { fieldSlug: "score", operator: "gt", value: 80 },
            { fieldSlug: "tag", operator: "eq", value: "green" },
          ],
        },
      ]);
      expect(namesFrom(page)).toEqual(
        expectedNames((row) => (row.score !== undefined && row.score > 80) || row.tag === "green"),
      );
      expect(namesFrom(page)).toEqual(["alpha", "delta"]);
    });

    it("ANDs a group with a bare comparison — the CNF shape", async () => {
      // (score >= 0) AND (tag = red OR tag = blue)
      const page = await query([
        { fieldSlug: "score", operator: "gte", value: 0 },
        {
          any: [
            { fieldSlug: "tag", operator: "eq", value: "red" },
            { fieldSlug: "tag", operator: "eq", value: "blue" },
          ],
        },
      ]);
      expect(namesFrom(page)).toEqual(
        expectedNames(
          (row) =>
            row.score !== undefined && row.score >= 0 && (row.tag === "red" || row.tag === "blue"),
        ),
      );
      expect(namesFrom(page)).toEqual(["alpha", "bravo", "echo"]);
    });

    it("expresses a multi-value IN as one group", async () => {
      const wanted = [90, 0, -5];
      const page = await query([
        { any: wanted.map((value) => ({ fieldSlug: "score", operator: "eq", value })) },
      ]);
      expect(namesFrom(page)).toEqual(
        expectedNames((row) => row.score !== undefined && wanted.includes(row.score)),
      );
    });

    it("still excludes an absent field from every branch of a group", async () => {
      // The monotone-collapse argument: with no NOT on the wire, a leaf that
      // sees no row is FALSE, and for an AND/OR tree that agrees with Kleene's
      // three-valued answer. "foxtrot" has no score, so no branch can rescue it.
      const page = await query([
        {
          any: [
            { fieldSlug: "score", operator: "gt", value: -1000 },
            { fieldSlug: "score", operator: "lte", value: -1000 },
          ],
        },
      ]);
      expect(namesFrom(page)).not.toContain("foxtrot");
    });

    it("pages exactly against a group, the same as against a bare comparison", async () => {
      const page = await client.records.list({
        baseId,
        limit: 2,
        valueFilters: [
          {
            any: [
              { fieldSlug: "tag", operator: "eq", value: "red" },
              { fieldSlug: "tag", operator: "eq", value: "blue" },
            ],
          },
        ],
      } as never);
      expect(page.records).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
    });
  });

  describe("the aggregates take the same value filters", () => {
    // Worth having on count/groupBy specifically because value filters are
    // exact BY CONSTRUCTION: a count scoped only by them stays one SQL
    // count(*), where an ad-hoc view filter whose parity cannot be proven makes
    // the endpoint read every candidate row and decide in memory.
    //
    // Every case is checked against `records.list` with the SAME filters rather
    // than against a hand-written number: the two endpoints have separate SQL
    // paths, so agreeing is the property that matters, and a hand count could
    // be wrong in the same direction as one of them.
    const listCount = async (valueFilters: unknown[]) =>
      (await client.records.list({ baseId, limit: 100, valueFilters } as never)).records.length;

    it("counts exactly what list would return", async () => {
      const valueFilters = [{ fieldSlug: "score", operator: "gte", value: 42 }];
      const counted = await client.records.count({ baseId, valueFilters } as never);
      expect(counted.total).toBe(3);
      expect(counted.total).toBe(await listCount(valueFilters));
    });

    it("counts against an `any` group", async () => {
      const valueFilters = [
        {
          any: [
            { fieldSlug: "tag", operator: "eq", value: "red" },
            { fieldSlug: "tag", operator: "eq", value: "green" },
          ],
        },
      ];
      const counted = await client.records.count({ baseId, valueFilters } as never);
      expect(counted.total).toBe(3);
      expect(counted.total).toBe(await listCount(valueFilters));
    });

    it("excludes an absent field from a count, the same way list does", async () => {
      const valueFilters = [{ fieldSlug: "score", operator: "ne", value: -1000 }];
      const counted = await client.records.count({ baseId, valueFilters } as never);
      expect(counted.total).toBe(5); // foxtrot has no score
      expect(counted.total).toBe(await listCount(valueFilters));
    });

    it("ANDs value filters with view filters on a count", async () => {
      const counted = await client.records.count({
        baseId,
        filters: [{ fieldSlug: "name", fieldType: "text", operator: "equals", value: "delta" }],
        valueFilters: [{ fieldSlug: "score", operator: "eq", value: 42 }],
      } as never);
      expect(counted.total).toBe(1);
    });

    it("groups only the records the value filters keep", async () => {
      const grouped = await client.records.groupBy({
        baseId,
        fieldSlug: "tag",
        valueFilters: [{ fieldSlug: "score", operator: "gte", value: 42 }],
      } as never);
      expect(grouped.total).toBe(3);
      expect(grouped.groups).toEqual([
        { value: "blue", count: 1 }, // echo
        { value: "green", count: 1 }, // delta
        { value: "red", count: 1 }, // alpha
      ]);
    });

    it("groups a checkbox under value filters, including its false bucket", async () => {
      const grouped = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        valueFilters: [{ fieldSlug: "score", operator: "lte", value: 42 }],
      } as never);
      // bravo(0,false) charlie(-5,false) delta(42,true) echo(42,true)
      expect(grouped.groups).toEqual([
        { value: "false", count: 2 },
        { value: "true", count: 2 },
      ]);
      expect(grouped.total).toBe(4);
    });

    it("refuses on the aggregates for the same reasons as on list", async () => {
      await expect(
        client.records.count({
          baseId,
          valueFilters: [{ fieldSlug: "blob", operator: "eq", value: "x" }],
        } as never),
      ).rejects.toThrow(/no exact value column/);
      // Refused by the schema itself (a field slug is only unambiguous within
      // one Base), so it surfaces as oRPC's input-validation error rather than
      // as the superRefine message — the point is that it never reaches SQL.
      await expect(
        client.records.count({
          valueFilters: [{ fieldSlug: "score", operator: "gt", value: 1 }],
        } as never),
      ).rejects.toThrow(/[Ii]nput validation failed/);
    });
  });

  describe("server-side numeric aggregates", () => {
    // Previously a caller had to read every record to add anything up. Each case
    // is checked against the same arithmetic done in plain JS over the seed —
    // the SQL path and the oracle are independent, so agreeing is the property
    // that matters.
    const scores = SEED.map((row) => row.score).filter(
      (score): score is number => score !== undefined,
    );

    it("aggregates the whole set as one bucket when no field is given", async () => {
      const result = await client.records.groupBy({
        baseId,
        aggregates: [
          { fn: "sum", fieldSlug: "score" },
          { fn: "avg", fieldSlug: "score" },
          { fn: "min", fieldSlug: "score" },
          { fn: "max", fieldSlug: "score" },
          { fn: "count", fieldSlug: "score" },
        ],
      } as never);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.value).toBeNull();
      expect(result.groups[0]?.count).toBe(SEED.length); // every record
      expect(result.groups[0]?.aggregates).toEqual({
        "sum:score": scores.reduce((sum, value) => sum + value, 0),
        "avg:score": scores.reduce((sum, value) => sum + value, 0) / scores.length,
        "min:score": Math.min(...scores),
        "max:score": Math.max(...scores),
        // count(field) counts PRESENT values; the group's own count counts
        // records. "foxtrot" has no score, so these differ by one.
        "count:score": scores.length,
      });
      expect(result.groups[0]?.aggregates?.["count:score"]).not.toBe(result.groups[0]?.count);
    });

    it("aggregates per group", async () => {
      const result = await client.records.groupBy({
        baseId,
        fieldSlug: "tag",
        aggregates: [{ fn: "sum", fieldSlug: "score" }],
      } as never);
      const expected = new Map<string | null, number>();
      for (const row of SEED) {
        if (row.score === undefined) continue;
        const key = row.tag ?? null;
        expected.set(key, (expected.get(key) ?? 0) + row.score);
      }
      for (const group of result.groups) {
        expect(group.aggregates?.["sum:score"]).toBe(expected.get(group.value) ?? null);
      }
    });

    it("narrows the aggregated set with value filters", async () => {
      const result = await client.records.groupBy({
        baseId,
        aggregates: [{ fn: "sum", fieldSlug: "score" }],
        valueFilters: [{ fieldSlug: "score", operator: "gte", value: 0 }],
      } as never);
      const wanted = SEED.filter((row) => row.score !== undefined && row.score >= 0).map(
        (row) => row.score as number,
      );
      expect(result.groups[0]?.aggregates?.["sum:score"]).toBe(
        wanted.reduce((sum, value) => sum + value, 0),
      );
    });

    it("returns NULL, not 0, for a group with no values at all", async () => {
      // "no rows with a value" and "rows summing to zero" are different answers,
      // and a dashboard renders them differently.
      const result = await client.records.groupBy({
        baseId,
        aggregates: [{ fn: "sum", fieldSlug: "score" }],
        valueFilters: [{ fieldSlug: "name", operator: "eq", value: "foxtrot" }],
      } as never);
      expect(result.groups[0]?.count).toBe(1);
      expect(result.groups[0]?.aggregates?.["sum:score"]).toBeNull();
      expect(result.groups[0]?.aggregates?.["sum:score"]).not.toBe(0);
    });

    it("omits `aggregates` entirely when none were asked for", async () => {
      const result = await client.records.groupBy({ baseId, fieldSlug: "tag" } as never);
      expect(result.groups[0]).not.toHaveProperty("aggregates");
    });

    it("agrees between the SQL path and the in-memory fallback", async () => {
      // `equals` on a NUMBER field is the genuinely-inexact case: a
      // currency-formatted number's preview text ("$1,234.00") differs from the
      // stored value, and whether the field is currency-formatted is not
      // visible from the (operator, type) pair — so this query takes the
      // in-memory fallback while the first takes the SQL path.
      //
      // Picking a genuinely-inexact filter is the whole point, and took two
      // tries: `not_empty` on text and `equals` on a select are BOTH provably
      // exact, so earlier versions of this test stayed on the SQL path and
      // passed even with the fallback's aggregates disabled.
      const viaSql = await client.records.groupBy({
        baseId,
        aggregates: [
          { fn: "sum", fieldSlug: "score" },
          { fn: "count", fieldSlug: "score" },
        ],
        valueFilters: [{ fieldSlug: "score", operator: "eq", value: 42 }],
      } as never);
      const viaFallback = await client.records.groupBy({
        baseId,
        aggregates: [
          { fn: "sum", fieldSlug: "score" },
          { fn: "count", fieldSlug: "score" },
        ],
        filters: [{ fieldSlug: "score", fieldType: "number", operator: "equals", value: 42 }],
      } as never);
      expect(viaFallback.groups[0]?.aggregates).toEqual(viaSql.groups[0]?.aggregates);
      expect(viaFallback.groups[0]?.aggregates?.["sum:score"]).toBe(84); // delta + echo
    });

    it("refuses to aggregate a field with no numeric column", async () => {
      await expect(
        client.records.groupBy({
          baseId,
          aggregates: [{ fn: "sum", fieldSlug: "name" }],
        } as never),
      ).rejects.toThrow(/Aggregates need a numeric value column/);
    });

    it("refuses to aggregate a field the Base does not have", async () => {
      await expect(
        client.records.groupBy({
          baseId,
          aggregates: [{ fn: "sum", fieldSlug: "nope" }],
        } as never),
      ).rejects.toThrow(/Field not found/);
    });
  });

  describe("bucketing: grid vs sql", () => {
    // The two disagree on real data, which is the reason this is a choice
    // rather than a fix. Every case below asserts the DIFFERENCE, not just that
    // each mode works — a bucketing option whose modes agreed would be noise.
    it("folds an unset checkbox into false under grid, and does not under sql", async () => {
      const grid = await client.records.groupBy({ baseId, fieldSlug: "done" } as never);
      const sqlMode = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        bucketing: "sql",
      } as never);
      // "foxtrot" has no `done` at all.
      expect(grid.groups).toEqual([
        { value: "false", count: 3 }, // bravo, charlie, foxtrot
        { value: "true", count: 3 },
      ]);
      expect(sqlMode.groups).toEqual([
        { value: false, count: 2 }, // bravo, charlie
        { value: true, count: 3 },
        { value: null, count: 1 }, // foxtrot gets its OWN bucket
      ]);
    });

    it("returns typed keys under sql, not stringified ones", async () => {
      const grouped = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        bucketing: "sql",
      } as never);
      expect(grouped.groups.map((group) => typeof group.value)).toEqual([
        "boolean",
        "boolean",
        "object", // null
      ]);
    });

    it("groups by a NUMBER field, which grid bucketing refuses", async () => {
      await expect(client.records.groupBy({ baseId, fieldSlug: "score" } as never)).rejects.toThrow(
        /Cannot group by a number field/,
      );

      const grouped = await client.records.groupBy({
        baseId,
        fieldSlug: "score",
        bucketing: "sql",
      } as never);
      // Sorted numerically, not lexically — otherwise 42 would follow 0 and 90.
      expect(grouped.groups).toEqual([
        { value: -5, count: 1 },
        { value: 0, count: 1 },
        { value: 42, count: 2 },
        { value: 90, count: 1 },
        { value: null, count: 1 }, // foxtrot
      ]);
    });

    it("still refuses to group by TEXT under sql — truncation can collide", async () => {
      await expect(
        client.records.groupBy({ baseId, fieldSlug: "name", bucketing: "sql" } as never),
      ).rejects.toThrow(/Cannot group by a text field/);
    });

    it("carries aggregates through sql bucketing", async () => {
      const grouped = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        bucketing: "sql",
        aggregates: [{ fn: "sum", fieldSlug: "score" }],
      } as never);
      const byKey = new Map(grouped.groups.map((group) => [group.value, group.aggregates]));
      expect(byKey.get(true)?.["sum:score"]).toBe(90 + 42 + 42); // alpha, delta, echo
      expect(byKey.get(false)?.["sum:score"]).toBe(0 + -5); // bravo, charlie
      expect(byKey.get(null)?.["sum:score"]).toBeNull(); // foxtrot has no score
    });

    it("agrees between the SQL path and the fallback under sql bucketing", async () => {
      const viaSql = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        bucketing: "sql",
      } as never);
      const viaFallback = await client.records.groupBy({
        baseId,
        fieldSlug: "done",
        bucketing: "sql",
        // `equals` on a number field cannot be proven exact, so this takes the
        // in-memory path.
        filters: [{ fieldSlug: "score", fieldType: "number", operator: "not_empty" }],
      } as never);
      // The fallback drops foxtrot (no score), so compare only the shared keys.
      const shared = new Map(viaFallback.groups.map((group) => [group.value, group.count]));
      expect(shared.get(true)).toBe(3);
      expect(shared.get(false)).toBe(2);
      expect(viaSql.groups.find((group) => group.value === null)?.count).toBe(1);
    });
  });

  describe("refuses rather than degrading", () => {
    // Every one of these could have been a silently-dropped condition. That
    // would hand back a superset while the caller believes it was filtered —
    // and this contract invites them to trust it with `limit`.
    it("rejects a field type with no exact value column", async () => {
      // `json` projects into value_json, which holds a structure rather than a
      // scalar — there is no column a comparison could be exact against.
      await expect(query([{ fieldSlug: "blob", operator: "eq", value: "x" }])).rejects.toThrow(
        /no exact value column/,
      );
    });

    it("rejects ORDERING on text — collation, not truncation, is what breaks it", async () => {
      // Postgres orders text by database collation and the caller orders it by
      // its own string comparison; en_US.UTF-8 puts 'a' < 'B' where JS does
      // not. An "exact" row set the caller cannot reproduce is worse than none.
      await expect(query([{ fieldSlug: "name", operator: "gt", value: "b" }])).rejects.toThrow(
        /collation/,
      );
    });

    it("rejects a text comparison at or over the projection limit", async () => {
      // value_text keeps the first VALUE_TEXT_INDEX_LIMIT characters. Below that
      // length, equality is provably exact; at or above it, a truncated stored
      // value could equal the target while the full value differs.
      await expect(
        query([{ fieldSlug: "name", operator: "eq", value: "x".repeat(8_000) }]),
      ).rejects.toThrow(/projection limit/);
    });

    it("rejects a non-boolean value on a checkbox field", async () => {
      // "yes" and 1, not "true": the two canonical query-string spellings ARE
      // accepted on purpose (see the test below), so they no longer belong in
      // the refusal list.
      await expect(query([{ fieldSlug: "done", operator: "eq", value: "yes" }])).rejects.toThrow(
        /not a boolean/,
      );
      await expect(query([{ fieldSlug: "done", operator: "eq", value: 1 }])).rejects.toThrow(
        /not a boolean/,
      );
    });

    it("rejects an unpushable field hidden INSIDE an `any` group", async () => {
      // A dropped disjunct would return a SUBSET — rows the caller asked for
      // would silently go missing, which is worse than the superset a dropped
      // conjunct produces. Both are refused; this proves the group path does
      // not quietly take the easier road.
      await expect(
        query([
          {
            any: [
              { fieldSlug: "score", operator: "eq", value: 42 },
              { fieldSlug: "blob", operator: "eq", value: "x" },
            ],
          },
        ]),
      ).rejects.toThrow(/no exact value column/);
    });

    it("rejects an unknown field slug", async () => {
      await expect(query([{ fieldSlug: "nope", operator: "gt", value: 1 }])).rejects.toThrow(
        /no field "nope"/,
      );
    });

    it("rejects a non-numeric value on a number field", async () => {
      await expect(
        query([{ fieldSlug: "score", operator: "gt", value: "banana" }]),
      ).rejects.toThrow(/not a number/);
    });

    it("rejects an unparseable date on a date field", async () => {
      await expect(query([{ fieldSlug: "due", operator: "gt", value: "banana" }])).rejects.toThrow(
        /not a valid date/,
      );
    });

    it("rejects value filters without a baseId", async () => {
      await expect(
        client.records.list({
          limit: 100,
          valueFilters: [{ fieldSlug: "score", operator: "gt", value: 1 }],
        } as never),
      ).rejects.toThrow(/requires baseId/);
    });
  });
});
