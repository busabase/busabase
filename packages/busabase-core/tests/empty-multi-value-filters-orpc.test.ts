import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `is_empty` / `not_empty` on a field whose value is a LIST (relation,
 * multiselect, attachment, member) must treat an empty list `[]` exactly like
 * an absent value. A relation that was cleared, or written as `[]` by an
 * import, previously rendered as the text "[]" in the filter evaluator and so
 * counted as NOT empty — "contracts with no linked lead" silently returned only
 * the records where the field had never been set.
 *
 * Every record is written through the normal ChangeRequest path. Four shapes
 * per field: never set, written as `[]`, set then cleared to `[]`, set then
 * cleared to null — plus one that holds a value.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("is_empty / not_empty on empty list values — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let leadId = "";
  const ids: Record<string, string> = {};

  const approveMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
    const result = merged.results[0];
    if (!result?.ok) throw new Error(result?.error ?? "merge failed");
    return result;
  };

  const create = async (fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({ baseId, fields, autoMerge: false });
    const result = await approveMerge(cr.id);
    if (!result.record) throw new Error("expected a record");
    return result.record.id;
  };

  const update = async (recordId: string, fields: Record<string, unknown>) => {
    const cr = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields,
      autoMerge: false,
    });
    await approveMerge(cr.id);
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-empty-list-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-empty-list-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const leads = await client.bases.create({
      slug: "leads",
      name: "Leads",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    const leadCr = await client.bases.createChangeRequest({
      baseId: leads.id,
      fields: { name: "Acme" },
      autoMerge: false,
    });
    leadId = (await approveMerge(leadCr.id)).record?.id ?? "";

    const contracts = await client.bases.create({
      slug: "contracts",
      name: "Contracts",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "lead",
          name: "Lead",
          type: "relation",
          required: false,
          options: { targetBaseId: leads.id },
        },
        {
          slug: "tags",
          name: "Tags",
          type: "multiselect",
          required: false,
          options: { choices: [{ id: "c_hot", name: "Hot" }] },
        },
        { slug: "files", name: "Files", type: "attachment", required: false, options: {} },
        { slug: "signed", name: "Signed", type: "checkbox", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = contracts.id;

    ids.unset = await create({ name: "unset" });
    ids.emptyList = await create({ name: "empty-list", lead: [], tags: [], files: [] });
    ids.clearedToList = await create({ name: "cleared-to-list", lead: [leadId], tags: ["c_hot"] });
    await update(ids.clearedToList, { name: "cleared-to-list", lead: [], tags: [] });
    ids.clearedToNull = await create({ name: "cleared-to-null", lead: [leadId], tags: ["c_hot"] });
    await update(ids.clearedToNull, { name: "cleared-to-null", lead: null, tags: null });
    ids.filled = await create({ name: "filled", lead: [leadId], tags: ["c_hot"] });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const emptyFor = (field: string): string[] =>
    field === "files"
      ? // attachments were only ever written on these two
        [ids.unset, ids.emptyList, ids.clearedToList, ids.clearedToNull, ids.filled]
      : [ids.unset, ids.emptyList, ids.clearedToList, ids.clearedToNull];

  const fieldTypes = { lead: "relation", tags: "multiselect", files: "attachment" } as const;

  for (const [fieldSlug, fieldType] of Object.entries(fieldTypes)) {
    describe(`${fieldType} field "${fieldSlug}"`, () => {
      const filter = (operator: "is_empty" | "not_empty") => [
        { fieldSlug, fieldType, operator } as const,
      ];

      it("records.listPage: is_empty matches every empty form, not_empty is the complement", async () => {
        const empty = await client.records.listPage({
          baseId,
          filters: filter("is_empty"),
          pageSize: 50,
        });
        const present = await client.records.listPage({
          baseId,
          filters: filter("not_empty"),
          pageSize: 50,
        });
        const expectedEmpty = emptyFor(fieldSlug);
        expect(empty.records.map((record) => record.id).sort()).toEqual([...expectedEmpty].sort());
        expect(empty.total).toBe(expectedEmpty.length);
        expect(empty.total + present.total).toBe(5);
        expect(
          present.records.some((record) => empty.records.some((other) => other.id === record.id)),
        ).toBe(false);
      });

      it("records.count agrees with records.listPage", async () => {
        const empty = await client.records.count({ baseId, filters: filter("is_empty") });
        const present = await client.records.count({ baseId, filters: filter("not_empty") });
        expect(empty.total).toBe(emptyFor(fieldSlug).length);
        expect(present.total).toBe(5 - emptyFor(fieldSlug).length);
      });

      it("records.list (superset contract) never drops an empty record", async () => {
        const listed = await client.records.list({ baseId, filters: filter("is_empty") });
        const listedIds = listed.records.map((record) => record.id);
        for (const id of emptyFor(fieldSlug)) expect(listedIds).toContain(id);
      });
    });
  }

  it("a saved View filtering `lead is_empty` agrees, via listPage and count", async () => {
    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "no-lead",
      name: "No lead",
      config: { filters: [{ fieldSlug: "lead", operator: "is_empty" }], sorts: [] },
      autoMerge: false,
    });
    const merged = await approveMerge(viewCr.id);
    const viewId = merged.view?.id;
    if (!viewId) throw new Error("view merge returned no id");

    const page = await client.records.listPage({ baseId, viewId, pageSize: 50 });
    expect(page.records.map((record) => record.id).sort()).toEqual([...emptyFor("lead")].sort());
    expect((await client.records.count({ baseId, viewId })).total).toBe(4);
  });

  it("records.groupBy agrees with records.count for an is_empty scope", async () => {
    // The relation filter is not exactly pushable, so this exercises groupBy's
    // evaluate-in-memory fallback. `signed` is never set → every row is "false".
    const grouped = await client.records.groupBy({
      baseId,
      fieldSlug: "signed",
      filters: [{ fieldSlug: "lead", fieldType: "relation", operator: "is_empty" }],
    });
    expect(grouped.total).toBe(4);
    expect(grouped.groups).toEqual([{ value: "false", count: 4 }]);
  });

  it("valueFilters refuses a relation field instead of guessing (no exact value column)", async () => {
    await expect(
      client.records.list({
        baseId,
        valueFilters: [{ fieldSlug: "lead", operator: "eq", value: "[]" }],
      }),
    ).rejects.toThrow(/no exact value column/);
  });

  it('`equals "[]"` no longer matches an empty list as if it were a value', async () => {
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "lead", fieldType: "relation", operator: "equals", value: "[]" }],
    });
    expect(total).toBe(0);
  });
});
