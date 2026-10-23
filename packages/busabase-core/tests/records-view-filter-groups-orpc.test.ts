import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { ViewConfigVO, ViewFilterVO } from "busabase-contract/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const eq = (fieldSlug: string, value: string): ViewFilterVO => ({
  fieldSlug,
  operator: "equals",
  value,
});

/** Real PostgreSQL-compatible round trips through saved-view CR creation and
 * every exact read path. Expected sets/sums are hand-computed from the seed. */
describe("saved view condition groups — page/count/aggregates", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  const merge = async (id: string) => {
    await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    const result = (await client.changeRequests.merge({ changeRequestIds: [id] })).results[0];
    if (!result?.ok) throw new Error(result?.error ?? "Merge returned no result");
    return result;
  };
  const seed = async (targetBaseId: string, records: Record<string, unknown>[]) => {
    await merge(
      (
        await client.bases.createBulkChangeRequest({
          baseId: targetBaseId,
          records,
          message: "Seed grouped filters",
        })
      ).id,
    );
  };
  const createView = async (slug: string, config: ViewConfigVO, targetBaseId = baseId) => {
    const result = await merge(
      (
        await client.views.changeRequest({
          operation: "create",
          baseId: targetBaseId,
          slug,
          name: slug,
          config,
          autoMerge: false,
        })
      ).id,
    );
    if (!result.view) throw new Error("Created view missing");
    return result.view.id;
  };
  const assertScope = async (
    viewId: string,
    names: string[],
    sum: number,
    filters?: ViewFilterVO[],
    targetBaseId = baseId,
  ) => {
    const scope = { baseId: targetBaseId, viewId, filters };
    const counted = await client.records.count(scope);
    expect(counted.total).toBe(names.length);
    const grouped = await client.records.groupBy({
      ...scope,
      aggregates: [{ fn: "sum", fieldSlug: "score" }],
    });
    expect(grouped.total).toBe(names.length);
    expect(grouped.groups[0]?.aggregates?.["sum:score"]).toBe(sum);
    const read: string[] = [];
    for (let page = 1; page <= Math.ceil(names.length / 2); page++) {
      const result = await client.records.listPage({
        ...scope,
        page,
        pageSize: 2,
        sort: { fieldSlug: "score", fieldType: "number", direction: "asc" },
      });
      expect(result.total).toBe(names.length);
      expect(result.totalPages).toBe(Math.ceil(names.length / 2));
      read.push(...result.records.map((record) => String(record.headCommit.payload.name)));
    }
    expect(read).toEqual(names);
    expect(new Set(read).size).toBe(names.length);
    // Exercise the saved sort / in-memory comparator path as well as explicit SQL sort.
    const savedOrder = await client.records.listPage({ ...scope, page: 1, pageSize: 100 });
    expect(
      savedOrder.records.map((record) => String(record.headCommit.payload.name)).sort(),
    ).toEqual([...names].sort());
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filter-groups-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filter-groups-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "group-tasks",
      name: "Tasks",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "owner", name: "Owner", type: "text" },
        {
          slug: "status",
          name: "Status",
          type: "select",
          options: {
            choices: [
              { id: "todo", name: "To do" },
              { id: "doing", name: "Doing" },
              { id: "done", name: "Done" },
            ],
          },
        },
        { slug: "score", name: "Score", type: "number" },
        {
          slug: "doubled",
          name: "Doubled",
          type: "formula",
          options: { formula: { expression: "{score} * 2" } },
        },
        { slug: "notes", name: "Notes", type: "html" },
        { slug: "retired", name: "Retired", type: "text" },
      ],
    });
    baseId = base.id;
    await seed(baseId, [
      {
        name: "A",
        owner: "me",
        status: "todo",
        score: 10,
        notes: '<p class="needle">no</p>',
        retired: "old",
      },
      { name: "B", owner: "me", status: "doing", score: 20, notes: "<p>needle</p>" },
      { name: "C", owner: "other", status: "todo", score: 30, notes: "<p>needle</p>" },
      { name: "D", owner: "me", status: "done", score: 40, notes: "<p>no</p>" },
      { name: "E", owner: "other", status: "doing", score: 50, notes: "<p>no</p>" },
      { name: "F", score: 60, notes: "" },
    ]);
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir])
      if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("rejects empty, malformed, too-deep and oversized expressions before saving", async () => {
    const leaf = eq("owner", "me");
    const invalidFilters: unknown[] = [
      [{ conjunction: "or", conditions: [] }],
      [{ conjunction: "or", conditions: null }],
      [null],
      [{ conjunction: "xor", conditions: [leaf] }],
      [
        {
          conjunction: "or",
          conditions: [
            { conjunction: "and", conditions: [{ conjunction: "or", conditions: [leaf] }] },
          ],
        },
      ],
      [
        { conjunction: "or", conditions: Array.from({ length: 51 }, () => leaf) },
        { conjunction: "and", conditions: Array.from({ length: 50 }, () => leaf) },
      ],
    ];
    for (const filters of invalidFilters) {
      await expect(
        client.views.changeRequest({
          operation: "create",
          baseId,
          slug: "invalid-expression",
          name: "Invalid expression",
          config: { filters, sorts: [] },
          autoMerge: true,
        } as never),
      ).rejects.toThrow();
    }
    expect(
      (await client.bases.listViews({ baseId })).some((view) => view.slug === "invalid-expression"),
    ).toBe(false);
    // Exactly 100 leaves across groups is valid; the root counts as depth 1.
    const viewId = await createView("maximum-valid-expression", {
      filters: [
        { conjunction: "or", conditions: Array.from({ length: 50 }, () => leaf) },
        { conjunction: "and", conditions: Array.from({ length: 50 }, () => leaf) },
      ],
      sorts: [],
    });
    expect((await client.records.count({ baseId, viewId })).total).toBe(3);
  });

  it("keeps legacy flat filters as AND", async () => {
    const viewId = await createView("legacy", {
      filters: [eq("owner", "me"), eq("status", "todo")],
      sorts: [],
    });
    await assertScope(viewId, ["A"], 10);
  });

  it("matches owner AND (todo OR doing), with exact SQL count and aggregates", async () => {
    const viewId = await createView("my-active", {
      filters: [
        eq("owner", "me"),
        { conjunction: "or", conditions: [eq("status", "todo"), eq("status", "doing")] },
      ],
      sorts: [],
    });
    await assertScope(viewId, ["A", "B"], 30);
    const grouped = await client.records.groupBy({
      baseId,
      viewId,
      fieldSlug: "status",
      aggregates: [{ fn: "sum", fieldSlug: "score" }],
    });
    expect(grouped.groups).toEqual([
      { value: "doing", count: 1, aggregates: { "sum:score": 20 } },
      { value: "todo", count: 1, aggregates: { "sum:score": 10 } },
    ]);
  });

  it("ANDs ad-hoc narrowing against the whole saved root OR", async () => {
    const viewId = await createView("mine-or-doing", {
      filterConjunction: "or",
      filters: [eq("owner", "me"), eq("status", "doing")],
      sorts: [],
    });
    await assertScope(viewId, ["A", "B", "D", "E"], 120);
    await assertScope(viewId, ["E"], 50, [eq("owner", "other")]);
  });

  it("preserves three levels and mixed OR/AND when a branch needs full-value fallback", async () => {
    // HTML attributes do not count as visible text: A must not match the first branch.
    const viewId = await createView("full-value", {
      filterConjunction: "or",
      filters: [
        {
          conjunction: "and",
          conditions: [
            eq("owner", "me"),
            {
              conjunction: "or",
              conditions: [
                { fieldSlug: "notes", operator: "contains", value: "needle" },
                eq("status", "done"),
              ],
            },
          ],
        },
        eq("owner", "other"),
      ],
      sorts: [],
    });
    await assertScope(viewId, ["B", "C", "D", "E"], 140);
    await assertScope(viewId, ["B", "D"], 60, [eq("owner", "me")]);
  });

  it("evaluates computed formula branches without treating them as exact projection predicates", async () => {
    const viewId = await createView("computed-or-done", {
      filters: [{ conjunction: "or", conditions: [eq("doubled", "40"), eq("status", "done")] }],
      sorts: [],
    });
    await assertScope(viewId, ["B", "D"], 60);
  });

  it("keeps missing-value semantics inside OR", async () => {
    const viewId = await createView("empty-or-todo", {
      filterConjunction: "or",
      filters: [{ fieldSlug: "owner", operator: "is_empty" }, eq("status", "todo")],
      sorts: [],
    });
    await assertScope(viewId, ["A", "C", "F"], 100);
  });

  it("fails closed for stale field identities in a group, without losing valid OR siblings", async () => {
    const viewId = await createView("stale", {
      filterConjunction: "or",
      filters: [
        { fieldSlug: "retired", fieldId: "fld_missing", operator: "is_empty" },
        eq("status", "todo"),
      ],
      sorts: [],
    });
    await assertScope(viewId, ["A", "C"], 40);
  });

  it("keeps a deleted leaf false inside a saved group instead of widening an empty-value branch", async () => {
    const viewId = await createView("deleted-in-group", {
      filters: [
        {
          conjunction: "or",
          conditions: [{ fieldSlug: "retired", operator: "is_empty" }, eq("status", "todo")],
        },
      ],
      sorts: [],
    });
    await assertScope(viewId, ["A", "B", "C", "D", "E", "F"], 210);
    const base = await client.bases.get({ baseId });
    const retired = base?.fields.find((field) => field.slug === "retired");
    if (!retired) throw new Error("Retired field missing");
    await merge(
      (
        await client.bases.fieldChangeRequest({
          operation: "delete",
          baseId,
          fieldId: retired.id,
          autoMerge: false,
        })
      ).id,
    );
    await assertScope(viewId, ["A", "C"], 40);
  });

  it("hydrates lookup leaves nested under OR before all exact read paths", async () => {
    const products = await client.bases.create({
      slug: "group-products",
      name: "Products",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "price", name: "Price", type: "number" },
      ],
    });
    await seed(products.id, [{ name: "Product", price: 25 }]);
    const productId = (await client.records.list({ baseId: products.id, limit: 10 })).records[0]
      ?.id;
    expect(productId).toBeTruthy();
    const orders = await client.bases.create({
      slug: "group-orders",
      name: "Orders",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "score", name: "Score", type: "number" },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseId: products.id, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "sum" },
          },
        },
      ],
    });
    await seed(orders.id, [
      { name: "Linked", score: 5, items: [productId] },
      { name: "Manual", score: 10 },
      { name: "Excluded", score: 15 },
    ]);
    const viewId = await createView(
      "lookup-or-manual",
      {
        filters: [{ conjunction: "or", conditions: [eq("total", "25"), eq("name", "Manual")] }],
        sorts: [],
      },
      orders.id,
    );
    await assertScope(viewId, ["Linked", "Manual"], 15, undefined, orders.id);
  });
});
