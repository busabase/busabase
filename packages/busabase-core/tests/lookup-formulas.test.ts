import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("lookup-dependent formulas use current merged values (real PGLite)", () => {
  let client: Client;
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let expenses: Awaited<ReturnType<Client["bases"]["create"]>>;
  let projects: Awaited<ReturnType<Client["bases"]["create"]>>;
  let expenseId = "";
  let projectId = "";
  let lowProjectId = "";

  const merge = async (id: string) => {
    await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    const {
      results: [result],
    } = await client.changeRequests.merge({ changeRequestIds: [id] });
    if (!result?.ok) throw new Error(result?.error ?? "Merge returned no result");
    return result;
  };
  const create = async (baseId: string, fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({ baseId, fields, autoMerge: false });
    const result = await merge(cr.id);
    if (!result.record) throw new Error("Expected created record");
    return result.record.id;
  };
  const fields = async (recordId = projectId) =>
    (await client.records.get({ recordId })).headCommit.payload;
  const filter = [
    { fieldSlug: "remaining", fieldType: "number", operator: "equals" as const, value: "350" },
  ];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "lookup-formulas-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "lookup-formulas-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    expenses = await client.bases.create({
      slug: "lookup-formula-expenses",
      name: "Expenses",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "amount", name: "Amount", type: "number" },
      ],
    });
    projects = await client.bases.create({
      slug: "lookup-formula-projects",
      name: "Projects",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "budget", name: "Budget", type: "number" },
        { slug: "active", name: "Active", type: "checkbox" },
        {
          slug: "expenses",
          name: "Expenses",
          type: "relation",
          options: { targetBaseSlug: expenses.slug, multiple: true },
        },
        {
          slug: "spent",
          name: "Spent",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "expenses", targetFieldSlug: "amount", rollup: "sum" },
          },
        },
        {
          slug: "remaining",
          name: "Remaining",
          type: "formula",
          options: { formula: { expression: "{budget} - {spent}" } },
        },
        {
          slug: "double",
          name: "Double remaining",
          type: "formula",
          options: { formula: { expression: "{remaining} * 2" } },
        },
        {
          slug: "local_only",
          name: "Local only",
          type: "formula",
          options: { formula: { expression: "{budget} * 3" } },
        },
      ],
    });
    expenseId = await create(expenses.id, { name: "Train", amount: 100 });
    projectId = await create(projects.id, {
      name: "Launch",
      budget: 500,
      active: true,
      expenses: [expenseId],
    });
    lowProjectId = await create(projects.id, {
      name: "Small",
      budget: 120,
      active: false,
      expenses: [expenseId],
    });
  });
  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("calculates direct and indirect formulas, excluding pending source proposals", async () => {
    const before = await client.records.get({ recordId: projectId });
    expect(before.headCommit.payload).toMatchObject({
      spent: 100,
      remaining: 400,
      double: 800,
      local_only: 1500,
    });
    const change = await client.records.changeRequest({
      operation: "update",
      recordId: expenseId,
      fields: { amount: 150 },
      autoMerge: false,
    });
    expect(await fields()).toMatchObject({ spent: 100, remaining: 400, double: 800 });
    await merge(change.id);
    const after = await client.records.get({ recordId: projectId });
    expect(after.headCommit.payload).toMatchObject({
      spent: 150,
      remaining: 350,
      double: 700,
      local_only: 1500,
    });
    expect(after.headCommitId).toBe(before.headCommitId);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("evaluates saved-view filters and sorts before page slicing", async () => {
    const cr = await client.views.changeRequest({
      operation: "create",
      baseId: projects.id,
      slug: "remaining-350",
      name: "Remaining 350",
      config: {
        filters: [{ fieldSlug: "remaining", operator: "equals", value: "350" }],
        sorts: [{ fieldSlug: "double", direction: "asc" }],
      },
      autoMerge: false,
    });
    const result = await merge(cr.id);
    if (!result.view) throw new Error("Expected view");
    const page = await client.records.listPage({
      baseId: projects.id,
      viewId: result.view.id,
      pageSize: 1,
    });
    expect(page.total).toBe(1);
    expect(page.records.map((record) => record.id)).toEqual([projectId]);
    expect(
      (await client.records.count({ baseId: projects.id, viewId: result.view.id })).total,
    ).toBe(1);
    const sort = await client.views.changeRequest({
      operation: "create",
      baseId: projects.id,
      slug: "remaining-order",
      name: "Remaining order",
      config: { filters: [], sorts: [{ fieldSlug: "double", direction: "asc" }] },
      autoMerge: false,
    });
    const sorted = await merge(sort.id);
    if (!sorted.view) throw new Error("Expected sorted view");
    const first = await client.records.listPage({
      baseId: projects.id,
      viewId: sorted.view.id,
      pageSize: 1,
    });
    const second = await client.records.listPage({
      baseId: projects.id,
      viewId: sorted.view.id,
      pageSize: 1,
      page: 2,
    });
    expect(first.records.map((record) => record.id)).toEqual([lowProjectId]);
    expect(second.records.map((record) => record.id)).toEqual([projectId]);
  });

  it("hydrates formula identities inside nested saved OR/AND filters for pages and aggregates", async () => {
    const base = await client.bases.get({ baseId: projects.id });
    const remaining = base.fields.find((field) => field.slug === "remaining");
    if (!remaining) throw new Error("Expected remaining formula");
    const proposed = await client.views.changeRequest({
      operation: "create",
      baseId: projects.id,
      slug: "nested-current-balance",
      name: "Nested current balance",
      config: {
        filterConjunction: "or",
        filters: [
          {
            conjunction: "and",
            conditions: [
              {
                // Stable identity remains authoritative even for a stale slug.
                fieldId: remaining.id,
                fieldSlug: "old_remaining",
                operator: "equals",
                value: "350",
              },
              { fieldSlug: "active", operator: "is_true" },
            ],
          },
          { fieldSlug: "name", operator: "equals", value: "Does not exist" },
        ],
        sorts: [{ fieldSlug: "double", direction: "asc" }],
      },
      autoMerge: false,
    });
    const merged = await merge(proposed.id);
    if (!merged.view) throw new Error("Expected nested saved view");
    const scope = { baseId: projects.id, viewId: merged.view.id };
    const page = await client.records.listPage({ ...scope, pageSize: 1 });
    expect(page.total).toBe(1);
    expect(page.records.map((record) => record.id)).toEqual([projectId]);
    expect(page.records[0]?.headCommit.payload.remaining).toBe(350);
    expect(await client.records.count(scope)).toEqual({ total: 1 });
    expect(await client.records.groupBy({ ...scope, fieldSlug: "active" })).toEqual({
      total: 1,
      groups: [{ value: "true", count: 1 }],
    });
  });

  it("counts and groups exactly on current formula filters, retaining aggregate restrictions", async () => {
    expect(await client.records.count({ baseId: projects.id, filters: filter })).toEqual({
      total: 1,
    });
    expect(
      await client.records.groupBy({
        baseId: projects.id,
        fieldSlug: "active",
        filters: filter,
        aggregates: [{ fn: "sum", fieldSlug: "budget" }],
      }),
    ).toEqual({
      total: 1,
      groups: [{ value: "true", count: 1, aggregates: { "sum:budget": 500 } }],
    });
    await expect(
      client.records.groupBy({
        baseId: projects.id,
        aggregates: [{ fn: "sum", fieldSlug: "remaining" }],
      }),
    ).rejects.toThrow();
    await expect(
      client.records.list({
        baseId: projects.id,
        valueFilters: [{ fieldSlug: "remaining", operator: "eq", value: 350 }],
      }),
    ).rejects.toThrow();
  });

  it("does not use caller type hints to prefilter stale formula projections", async () => {
    const page = await client.records.list({ baseId: projects.id, filters: filter });
    expect(page.records.some((record) => record.id === projectId)).toBe(true);
    expect(
      (await client.records.list({ filters: filter })).records.some(
        (record) => record.id === projectId,
      ),
    ).toBe(true);
  });

  it("uses current numeric values for explicit sort, stable keyset and offset pages", async () => {
    const sort = { fieldSlug: "remaining", fieldType: "number", direction: "asc" as const };
    const first = await client.records.list({ baseId: projects.id, sort, limit: 1 });
    expect(first.records.map((record) => record.id)).toEqual([lowProjectId]);
    expect(first.nextCursor).not.toBeNull();
    if (!first.nextCursor) throw new Error("Expected next cursor");
    const next = await client.records.list({
      baseId: projects.id,
      sort,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(next.records.map((record) => record.id)).toEqual([projectId]);
    expect(next.nextCursor).toBeNull();
    const page = await client.records.listPage({ baseId: projects.id, sort, pageSize: 1, page: 2 });
    expect(page.records.map((record) => record.id)).toEqual([projectId]);
    const descending = await client.records.list({
      baseId: projects.id,
      sort: { ...sort, direction: "desc" },
      limit: 1,
    });
    expect(descending.records.map((record) => record.id)).toEqual([projectId]);
  });

  it("sorts by current values when source edits invert the stored order, including tied and null cursors", async () => {
    const base = await client.bases.create({
      slug: "lookup-formula-sort",
      name: "Dynamic sort",
      autoMerge: true,
      fields: projects.fields.map(({ slug, name, type, options, required }) => ({
        slug,
        name,
        type,
        options,
        required,
      })),
    });
    const cheap = await create(expenses.id, { name: "Cheap", amount: 10 });
    const firstId = await create(base.id, {
      name: "Budget 500",
      budget: 500,
      expenses: [expenseId],
    });
    const secondId = await create(base.id, { name: "Budget 450", budget: 450, expenses: [cheap] });
    const tiedId = await create(base.id, {
      name: "Same remaining",
      budget: 500,
      expenses: [expenseId],
    });
    const invalidBase = await client.bases.create({
      slug: "lookup-formula-invalid-target",
      name: "Invalid target",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseSlug: expenses.slug, multiple: true },
        },
        {
          slug: "spent",
          name: "Spent",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "amount", rollup: "sum" },
          },
        },
        {
          slug: "zero",
          name: "Zero division",
          type: "formula",
          options: { formula: { expression: "1 / ({spent} - {spent})" } },
        },
        {
          slug: "dependent",
          name: "Dependent",
          type: "formula",
          options: { formula: { expression: "{zero} + 10" } },
        },
      ],
    });
    const broken = await create(invalidBase.id, { name: "Cannot calculate", items: [cheap] });
    expect(await fields(broken)).toMatchObject({ zero: null, dependent: null });
    const sort = { fieldSlug: "remaining", fieldType: "number", direction: "asc" as const };
    const expected = [firstId, tiedId].sort().concat(secondId);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.records.list({ baseId: base.id, sort, limit: 1, cursor });
      seen.push(...page.records.map((record) => record.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && seen.length < 5);
    expect(seen).toEqual(expected);
    const desc = await client.records.list({
      baseId: base.id,
      sort: { ...sort, direction: "desc" },
    });
    expect(desc.records.map((record) => record.id)).toEqual([secondId, ...expected.slice(0, 2)]);
    const offset = await client.records.listPage({ baseId: base.id, sort, pageSize: 1, page: 3 });
    expect(offset.records.map((record) => record.id)).toEqual([secondId]);
    // Hide the shared expense Base: every dynamic total is unavailable,
    // so NULLS LAST collapses to the stable id tiebreaker across all pages.
    await client.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "workspace" });
    await client.nodes.updateVisibility({ nodeId: expenses.nodeId, visibility: "private" });
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "usr_lookup_sort_reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      async () => {
        const first = await client.records.list({ baseId: base.id, sort, limit: 1 });
        expect(first.records[0]?.headCommit.payload.remaining).toBeNull();
        const next = await client.records.list({
          baseId: base.id,
          sort,
          limit: 2,
          cursor: first.nextCursor ?? undefined,
        });
        expect([...first.records, ...next.records].map((record) => record.id)).toEqual(
          [firstId, secondId, tiedId].sort(),
        );
      },
    );
    await client.nodes.updateVisibility({ nodeId: expenses.nodeId, visibility: "workspace" });
  });

  it("keeps correct dynamic formulas in compact summaries without adding lookup metadata", async () => {
    for (const input of [
      { baseId: projects.id, summary: true },
      {
        baseId: projects.id,
        summary: true,
        sort: { fieldSlug: "remaining", fieldType: "number", direction: "desc" as const },
        limit: 1,
      },
    ]) {
      const page = await client.records.list(input);
      const project = page.records.find((record) => record.id === projectId);
      expect(project?.headCommit.payload).toMatchObject({ remaining: 350, double: 700 });
      expect(project?.computedFields).toBeUndefined();
      expect(project?.base.fields).toEqual([]);
      expect(project?.headCommit.payload.spent).toBeUndefined();
    }
  });

  it("uses complete inputs for dynamic summary formulas while keeping large outputs compact", async () => {
    const base = await client.bases.create({
      slug: "lookup-formula-summary-long",
      name: "Long summary",
      autoMerge: true,
      fields: [
        ...projects.fields.map(({ slug, name, type, options, required }) => ({
          slug,
          name,
          type,
          options,
          required,
        })),
        { slug: "note", name: "Long note", type: "text" },
        {
          slug: "length",
          name: "Length plus spent",
          type: "formula",
          options: { formula: { expression: "LEN({note}) + {spent}" } },
        },
        {
          slug: "long_result",
          name: "Long result",
          type: "formula",
          options: { formula: { expression: 'REPT("x", {spent} * 100)' } },
        },
      ],
    });
    const id = await create(base.id, {
      name: "Long inputs",
      budget: 500,
      expenses: [expenseId],
      note: "n".repeat(10_000),
    });
    const full = await client.records.get({ recordId: id });
    expect(full.headCommit.payload.length).toBe(10_150);
    expect(full.headCommit.payload.long_result).toHaveLength(15_000);
    const summary = (await client.records.list({ baseId: base.id, summary: true })).records[0];
    expect(summary?.headCommit.payload.length).toBe(10_150);
    expect(JSON.stringify(summary).length).toBeLessThan(4096);
    expect(summary?.headCommit.payload.long_result).not.toBe(full.headCommit.payload.long_result);
  });

  it("matches current values in exact field get and search, scoped and cross-Base", async () => {
    expect(
      (await client.records.get({ baseId: projects.id, fieldSlug: "remaining", valueText: "350" }))
        .id,
    ).toBe(projectId);
    await expect(
      client.records.get({ baseId: projects.id, fieldSlug: "remaining", valueText: "500" }),
    ).rejects.toThrow();
    expect(
      (
        await client.records.search({ baseId: projects.id, fieldSlug: "double", valueText: "700" })
      ).map((record) => record.id),
    ).toEqual([projectId]);
    const crossBase = await client.records.search({ fieldSlug: "remaining", valueText: "350" });
    expect(crossBase.map((record) => record.id)).toContain(projectId);
    expect(crossBase.every((record) => record.headCommit.payload.remaining === 350)).toBe(true);
    expect(
      await client.records.search({
        baseId: projects.id,
        fieldSlug: "remaining",
        valueText: "500",
      }),
    ).toEqual([]);
  });

  it("nulls the entire formula chain for hidden sources without changing local formulas", async () => {
    await client.nodes.updateVisibility({ nodeId: projects.nodeId, visibility: "workspace" });
    await client.nodes.updateVisibility({ nodeId: expenses.nodeId, visibility: "private" });
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "usr_lookup_formula_reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      async () => {
        const hidden = await client.records.get({ recordId: projectId });
        expect(hidden.headCommit.payload).toMatchObject({
          spent: null,
          remaining: null,
          double: null,
          local_only: 1500,
        });
        expect(hidden.computedFields?.spent.status).toBe("inaccessible");
        expect(await client.records.count({ baseId: projects.id, filters: filter })).toEqual({
          total: 0,
        });
        expect(
          await client.records.search({
            baseId: projects.id,
            fieldSlug: "remaining",
            valueText: "500",
          }),
        ).toEqual([]);
        expect(
          (await client.records.list({ baseId: projects.id, summary: true })).records.find(
            (record) => record.id === projectId,
          )?.headCommit.payload.remaining,
        ).toBeNull();
      },
    );
    await client.nodes.updateVisibility({ nodeId: expenses.nodeId, visibility: "workspace" });
  });

  it("rejects stale cross-Base dynamic formula targets as invalid instead of returning a number", async () => {
    const downstream = await client.bases.create({
      slug: "lookup-formula-downstream",
      name: "Downstream",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        {
          slug: "projects",
          name: "Projects",
          type: "relation",
          options: { targetBaseSlug: projects.slug, multiple: true },
        },
        {
          slug: "upstream",
          name: "Upstream",
          type: "lookup",
          options: {
            lookup: {
              relationFieldSlug: "projects",
              targetFieldSlug: "remaining",
              rollup: "values",
            },
          },
        },
        {
          slug: "dependent",
          name: "Dependent",
          type: "formula",
          options: { formula: { expression: "{upstream} + 1" } },
        },
      ],
    });
    const id = await create(downstream.id, { name: "Linked", projects: [projectId] });
    const record = await client.records.get({ recordId: id });
    expect(record.computedFields?.upstream.status).toBe("invalid");
    expect(record.headCommit.payload).toMatchObject({ upstream: null, dependent: null });
  });

  it("preserves existing null arithmetic for unlinked and linked-empty values", async () => {
    const unlinkedId = await create(projects.id, { name: "Unlinked", budget: 500 });
    const emptyExpense = await create(expenses.id, { name: "No amount yet" });
    const emptyId = await create(projects.id, {
      name: "Empty amount",
      budget: 500,
      expenses: [emptyExpense],
    });
    const unlinked = await client.records.get({ recordId: unlinkedId });
    const empty = await client.records.get({ recordId: emptyId });
    expect(unlinked.computedFields?.spent.status).toBe("unlinked");
    expect(empty.computedFields?.spent.status).toBe("empty");
    for (const record of [unlinked, empty]) {
      expect(record.headCommit.payload).toMatchObject({
        spent: null,
        remaining: 500,
        double: 1000,
      });
    }
  });

  it("nulls the whole formula chain when the relation hop is deleted", async () => {
    const relation = projects.fields.find((field) => field.slug === "expenses");
    if (!relation) throw new Error("Expected relation field");
    const cr = await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: projects.id,
      fieldId: relation.id,
      autoMerge: false,
    });
    await merge(cr.id);
    expect(await fields()).toMatchObject({
      spent: null,
      remaining: null,
      double: null,
      local_only: 1500,
    });
  });
});
