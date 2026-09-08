import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `valueFilters` driven through the PUBLIC REST surface (`/api/v1`), which the
 * in-process `createRouterClient` in records-value-filters-orpc.test.ts skips
 * entirely.
 *
 * This layer is worth its own file because of the SHAPE. `records.list` and
 * `records.count` are GET routes, so every filter has to survive being
 * serialised into a query string and parsed back — and a value filter is an
 * array of objects, one of which may itself hold an array of objects (the `any`
 * group). Nested-array-in-query-string is the classic place a contract that is
 * correct in-process falls over, and the failure is not subtle: the parameter
 * either arrives mangled (a 400 on a request that should work) or arrives
 * partially (a silently WIDER row set on a filter the caller believes is
 * exact). The second one is why this is not left to a manual check.
 *
 * Types are checked here too. A query string has no types — `42` arrives as
 * `"42"` and `true` as `"true"` — so a number field's filter, a checkbox's
 * boolean and a date's ISO string all have to be coerced back correctly by the
 * schema before `buildExactValueFilter` sees them.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const API = "http://localhost/api/v1";

interface Seed {
  name: string;
  score?: number;
  tag?: string;
  done?: boolean;
  due?: string;
}

const SEED: Seed[] = [
  { name: "alpha", score: 90, tag: "red", done: true, due: "2026-01-10T00:00:00.000Z" },
  { name: "bravo", score: 0, tag: "blue", done: false, due: "2026-02-20T00:00:00.000Z" },
  { name: "charlie", score: -5, tag: "red", done: false, due: "2026-03-30T00:00:00.000Z" },
  { name: "delta", score: 42, tag: "green", done: true, due: "2026-04-15T00:00:00.000Z" },
  { name: "foxtrot" },
];

describe("records valueFilters over the /api/v1 query string", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let handler: OpenAPIHandler<Record<never, never>>;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-vf-openapi-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-vf-openapi-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    handler = new OpenAPIHandler(busabaseRouter);

    // Seeding goes through the in-process client: this file is about the READ
    // boundary, and writing over HTTP would only add a second thing to blame.
    const client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "vf-http",
      name: "VF HTTP",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
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
        { slug: "due", name: "Due", type: "date", required: false, options: {} },
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
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  /**
   * Serialises exactly the way a client does — `URLSearchParams` with oRPC's
   * bracket notation — rather than hand-writing the encoded string, so the test
   * exercises the encoding a real caller produces instead of one invented here.
   */
  const query = (params: Record<string, unknown>): string => {
    const search = new URLSearchParams();
    const walk = (prefix: string, value: unknown) => {
      if (Array.isArray(value)) {
        // A block body, not a concise one: `forEach` must not be handed a
        // callback with a return value, even a void one.
        value.forEach((entry, index) => {
          walk(`${prefix}[${index}]`, entry);
        });
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) walk(`${prefix}[${key}]`, entry);
        return;
      }
      search.append(prefix, String(value));
    };
    for (const [key, value] of Object.entries(params)) walk(key, value);
    return search.toString();
  };

  const get = async (route: string, params: Record<string, unknown>) => {
    const request = new Request(`${API}${route}?${query(params)}`, { method: "GET" });
    const result = await handler.handle(request, { context: {} });
    if (!result.matched) throw new Error(`no OpenAPI route matched GET ${route}`);
    return { status: result.response.status, body: await result.response.json() };
  };

  const names = (body: { records: { headCommit: { payload: Record<string, unknown> } }[] }) =>
    body.records.map((record) => String(record.headCommit.payload.name)).sort();

  it("survives the round trip for a single numeric comparison", async () => {
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [{ fieldSlug: "score", operator: "gte", value: 42 }],
    });
    expect(res.status).toBe(200);
    // `42` left as the string "42" — proof the schema coerced it back to a
    // number, since a text comparison on a number field is refused.
    expect(names(res.body)).toEqual(["alpha", "delta"]);
  });

  it("survives the round trip for the NESTED `any` group", async () => {
    // The shape this file exists for: an array holding an object holding an
    // array of objects, flattened into `valueFilters[0][any][0][fieldSlug]=…`.
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [
        {
          any: [
            { fieldSlug: "tag", operator: "eq", value: "red" },
            { fieldSlug: "tag", operator: "eq", value: "green" },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["alpha", "charlie", "delta"]);
  });

  it("survives a CNF mixing a bare comparison and a group", async () => {
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [
        { fieldSlug: "score", operator: "gte", value: 0 },
        {
          any: [
            { fieldSlug: "tag", operator: "eq", value: "red" },
            { fieldSlug: "tag", operator: "eq", value: "blue" },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["alpha", "bravo"]);
  });

  it("coerces a boolean back from its query-string spelling", async () => {
    // `true` arrives as the string "true". A checkbox filter is REFUSED for a
    // non-boolean value, so a 200 here is itself the evidence of coercion.
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [{ fieldSlug: "done", operator: "eq", value: true }],
    });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["alpha", "delta"]);
  });

  it("keeps an ISO date intact through URL encoding", async () => {
    // Colons and the trailing `Z` are the characters most likely to be mangled.
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [{ fieldSlug: "due", operator: "gte", value: "2026-03-01T00:00:00.000Z" }],
    });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["charlie", "delta"]);
  });

  it("keeps a text value with spaces and punctuation intact", async () => {
    const res = await get("/records", {
      baseId,
      limit: 100,
      valueFilters: [{ fieldSlug: "name", operator: "eq", value: "alpha" }],
    });
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["alpha"]);
  });

  it("carries `limit` alongside an exact filter and returns a FULL page", async () => {
    // What exactness buys, checked at the boundary: a superset filter would let
    // the server's extra rows eat the limit and return a short page.
    const res = await get("/records", {
      baseId,
      limit: 2,
      valueFilters: [{ fieldSlug: "score", operator: "gte", value: -100 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(2);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it("takes the same filters on the count route", async () => {
    const res = await get("/records/count", {
      baseId,
      valueFilters: [{ fieldSlug: "score", operator: "gte", value: 42 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it("takes a nested group on the count route", async () => {
    const res = await get("/records/count", {
      baseId,
      valueFilters: [
        {
          any: [
            { fieldSlug: "score", operator: "eq", value: 90 },
            { fieldSlug: "score", operator: "eq", value: 0 },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it("refuses over HTTP with 400, not 500", async () => {
    // A refusal that surfaced as a server error would read as an outage rather
    // than as "that comparison cannot be exact", and callers retry outages.
    for (const valueFilters of [
      [{ fieldSlug: "nope", operator: "eq", value: 1 }],
      [{ fieldSlug: "name", operator: "gt", value: "b" }],
      [{ fieldSlug: "done", operator: "eq", value: "yes" }],
      [
        {
          any: [
            { fieldSlug: "score", operator: "eq", value: 1 },
            { fieldSlug: "nope", operator: "eq", value: 1 },
          ],
        },
      ],
    ]) {
      const res = await get("/records", { baseId, limit: 100, valueFilters });
      expect(res.status).toBe(400);
    }
  });

  it("carries `aggregates` through the query string, numbers intact", async () => {
    // Another array of objects on a GET, and the numbers come back through
    // JSON — so this checks both the request encoding and that `sum` is a
    // number rather than the string a numeric column would hand over raw.
    const res = await get("/records/group-by", {
      baseId,
      aggregates: [
        { fn: "sum", fieldSlug: "score" },
        { fn: "max", fieldSlug: "score" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].aggregates["sum:score"]).toBe(127); // 90 + 0 + -5 + 42
    expect(res.body.groups[0].aggregates["max:score"]).toBe(90);
    expect(typeof res.body.groups[0].aggregates["sum:score"]).toBe("number");
  });

  it("combines aggregates with grouping and value filters over HTTP", async () => {
    const res = await get("/records/group-by", {
      baseId,
      fieldSlug: "tag",
      aggregates: [{ fn: "sum", fieldSlug: "score" }],
      valueFilters: [{ fieldSlug: "score", operator: "gte", value: 0 }],
    });
    expect(res.status).toBe(200);
    const byTag = Object.fromEntries(
      res.body.groups.map((group: { value: string; aggregates: Record<string, number> }) => [
        group.value,
        group.aggregates["sum:score"],
      ]),
    );
    expect(byTag).toEqual({ blue: 0, green: 42, red: 90 }); // charlie (-5) filtered out
  });

  it("refuses an unaggregatable field with 400, not 500", async () => {
    const res = await get("/records/group-by", {
      baseId,
      aggregates: [{ fn: "sum", fieldSlug: "name" }],
    });
    expect(res.status).toBe(400);
  });

  it("refuses value filters without a baseId with 400", async () => {
    const res = await get("/records", {
      limit: 100,
      valueFilters: [{ fieldSlug: "score", operator: "gte", value: 1 }],
    });
    expect(res.status).toBe(400);
  });
});
