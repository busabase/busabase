import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `records.groupBy` returns the per-bucket split a board column header or a
 * summary tile renders, so — like `records.count` — every number must be exact,
 * not a superset. Two independent implementations have to agree: the cheap SQL
 * GROUP BY (taken when every filter is provably pushable) and the
 * evaluate-every-row fallback (taken when one isn't). These tests pin both
 * against hand-counted totals AND cross-check them against `records.count`,
 * which resolves its own scope through the same shared helper but aggregates
 * separately.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("records.groupBy — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-group-by-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-group-by-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "tickets",
      name: "Tickets",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "owner", name: "Owner", type: "text", required: false, options: {} },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "c_todo", name: "To do" },
              { id: "c_doing", name: "Doing" },
              { id: "c_done", name: "Done" },
            ],
          },
        },
        { slug: "urgent", name: "Urgent", type: "checkbox", required: false, options: {} },
        { slug: "notes", name: "Notes", type: "html", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    // Fixed seed — every expectation below is hand-counted from this table.
    // stage: 3× c_todo, 2× c_doing, 1× c_done, 2× unset (the null bucket).
    // urgent: 3× true, 2× false, 3× unset (which must fold INTO false → 5).
    // `notes` is html: a filter on it can never be pushed down, so it is the
    // lever that forces the fallback path for the cross-check below.
    const records: Array<Record<string, unknown>> = [
      { name: "T1", owner: "ana", stage: "c_todo", urgent: true, notes: "<p>alpha</p>" },
      { name: "T2", owner: "ana", stage: "c_todo", urgent: false, notes: "<p>beta</p>" },
      { name: "T3", owner: "bo", stage: "c_todo", urgent: true, notes: "<p>alpha</p>" },
      { name: "T4", owner: "bo", stage: "c_doing", urgent: false, notes: "<p>beta</p>" },
      { name: "T5", owner: "ana", stage: "c_doing", urgent: true, notes: "<p>alpha</p>" },
      { name: "T6", owner: "cy", stage: "c_done", notes: "<p>alpha</p>" }, // urgent unset
      { name: "T7", owner: "cy", notes: "<p>beta</p>" }, // stage + urgent unset
      { name: "T8", owner: "cy", notes: "<p>alpha</p>" }, // stage + urgent unset
    ];
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed tickets",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("groups a select field, with unset records in the null bucket", async () => {
    const { groups, total } = await client.records.groupBy({ baseId, fieldSlug: "stage" });
    expect(groups).toEqual([
      { value: "c_doing", count: 2 },
      { value: "c_done", count: 1 },
      { value: "c_todo", count: 3 },
      { value: null, count: 2 },
    ]);
    expect(total).toBe(8);
  });

  it("returns choice IDs, not labels, so a rename can't shift the buckets", async () => {
    const { groups } = await client.records.groupBy({ baseId, fieldSlug: "stage" });
    expect(groups.map((group) => group.value)).not.toContain("To do");
    expect(groups.map((group) => group.value)).toContain("c_todo");
  });

  it("folds an unset checkbox into false rather than its own bucket", async () => {
    const { groups, total } = await client.records.groupBy({ baseId, fieldSlug: "urgent" });
    // 3 true; 2 explicit false + 3 unset = 5 false. No null bucket.
    expect(groups).toEqual([
      { value: "false", count: 5 },
      { value: "true", count: 3 },
    ]);
    expect(total).toBe(8);
  });

  it("total always equals records.count for the same scope", async () => {
    const scope = {
      baseId,
      filters: [
        { fieldSlug: "owner", fieldType: "text", operator: "equals" as const, value: "ana" },
      ],
    };
    const [grouped, counted] = await Promise.all([
      client.records.groupBy({ ...scope, fieldSlug: "stage" }),
      client.records.count(scope),
    ]);
    expect(grouped.total).toBe(counted.total);
    expect(grouped.total).toBe(3); // T1, T2, T5
    expect(grouped.groups).toEqual([
      { value: "c_doing", count: 1 },
      { value: "c_todo", count: 2 },
    ]);
  });

  it("the un-pushable (fallback) path agrees with the pushdown path", async () => {
    // An `html` contains filter can never be pushed down — the client's preview
    // strips tags, the stored projection doesn't — so this takes the fallback.
    // "alpha" appears in the visible text of T1, T3, T5, T6, T8.
    const fallback = await client.records.groupBy({
      baseId,
      fieldSlug: "stage",
      filters: [{ fieldSlug: "notes", fieldType: "html", operator: "contains", value: "alpha" }],
    });
    expect(fallback.total).toBe(5);
    expect(fallback.groups).toEqual([
      { value: "c_doing", count: 1 }, // T5
      { value: "c_done", count: 1 }, // T6
      { value: "c_todo", count: 2 }, // T1, T3
      { value: null, count: 1 }, // T8
    ]);
    // Same scope through records.count, which takes its own fallback branch.
    const counted = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "notes", fieldType: "html", operator: "contains", value: "alpha" }],
    });
    expect(fallback.total).toBe(counted.total);
  });

  it("rejects grouping by a field whose stored value is not the bucket key", async () => {
    // text: valueText is truncated at the projection limit, so long values collide.
    await expect(client.records.groupBy({ baseId, fieldSlug: "owner" })).rejects.toThrow(
      /Cannot group by a text field/,
    );
  });

  it("404s on a field the Base doesn't have", async () => {
    await expect(client.records.groupBy({ baseId, fieldSlug: "nope" })).rejects.toThrow(
      /Field not found/,
    );
  });

  it("404s on an unknown Base rather than reporting an empty split", async () => {
    await expect(
      client.records.groupBy({ baseId: "bas_missing", fieldSlug: "stage" }),
    ).rejects.toThrow(/Base not found/);
  });
});
