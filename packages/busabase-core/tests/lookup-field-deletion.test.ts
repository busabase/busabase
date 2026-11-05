import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, getPgliteClient } from "../src/db";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
} from "../src/db/schema";
import { isSystemFieldType } from "../src/domains/base/field-types";
import { isDeletableFieldType } from "../src/domains/base/utils/field-capabilities";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("lookup field deletion through oRPC and real PGlite", () => {
  let client: Client;
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let sequence = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "lookup-field-delete-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "lookup-field-delete-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    if (dataDir) await (await getPgliteClient()).close();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    for (const directory of [dataDir, storageDir]) {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  });

  const merge = async (id: string) => {
    await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    const { results } = await client.changeRequests.merge({ changeRequestIds: [id] });
    const result = results[0];
    if (!result?.ok) {
      throw Object.assign(new Error(result?.error ?? "No merge result"), {
        code: result?.code,
        data: result?.data,
      });
    }
    return result;
  };

  const createRecord = async (baseId: string, fields: Record<string, unknown>) => {
    const request = await client.bases.createChangeRequest({ baseId, fields, autoMerge: false });
    const result = await merge(request.id);
    if (!result.record) throw new Error("Expected record");
    return result.record.id;
  };

  const setup = async () => {
    const suffix = ++sequence;
    const source = await client.bases.create({
      slug: `delete-source-${suffix}`,
      name: "Source",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "amount", name: "Amount", type: "number" },
      ],
    });
    const base = await client.bases.create({
      slug: `delete-lookup-${suffix}`,
      name: "Lookups",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text" },
        {
          slug: "source",
          name: "Source",
          type: "relation",
          options: { targetBaseSlug: source.slug, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "source", targetFieldSlug: "amount", rollup: "sum" },
          },
        },
      ],
    });
    const lookup = base.fields.find((field) => field.slug === "total");
    if (!lookup) throw new Error("Missing lookup");
    const sourceId = await createRecord(source.id, { name: "Source row", amount: 12 });
    const recordId = await createRecord(base.id, { name: "Row", source: [sourceId], total: 999 });
    return { base, source, lookup, sourceId, recordId };
  };

  const requestDelete = (baseId: string, fieldId: string) =>
    client.bases.fieldChangeRequest({ operation: "delete", baseId, fieldId, autoMerge: false });

  it("separates deleting a lookup definition from writing read-only values", () => {
    expect(isDeletableFieldType("lookup")).toBe(true);
    expect(isSystemFieldType("lookup")).toBe(true);
    for (const type of [
      "created_time",
      "updated_time",
      "created_by",
      "updated_by",
      "auto_number",
    ] as const) {
      expect(isDeletableFieldType(type)).toBe(false);
    }
    expect(isDeletableFieldType("relation")).toBe(true);
    expect(isDeletableFieldType("formula")).toBe(true);
  });

  it("deletes and restores the same lookup without touching source records, links, or prior history", async () => {
    const { base, lookup, recordId, sourceId } = await setup();
    const db = await getDb();
    const storedRecords = await db.select().from(busabaseRecords);
    const links = await db.select().from(busabaseRecordLinks);
    expect((await client.records.get({ recordId })).headCommit.payload.total).toBe(12);
    const deletion = await requestDelete(base.id, lookup.id);
    const commits = await db.select().from(busabaseCommits);
    await merge(deletion.id);
    expect(
      (await client.bases.get({ baseId: base.id })).fields.map((field) => field.id),
    ).not.toContain(lookup.id);
    expect((await client.records.get({ recordId })).headCommit.payload).not.toHaveProperty("total");
    expect(await db.select().from(busabaseRecords)).toEqual(storedRecords);
    expect(await db.select().from(busabaseRecordLinks)).toEqual(links);
    const [deleted] = await db
      .select()
      .from(busabaseBaseFields)
      .where(eq(busabaseBaseFields.id, lookup.id));
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(await db.select().from(busabaseCommits)).toEqual(commits);
    const sourceChange = await client.records.changeRequest({
      operation: "update",
      recordId: sourceId,
      fields: { amount: 27 },
      autoMerge: false,
    });
    await merge(sourceChange.id);
    const recordsBeforeRestore = await db.select().from(busabaseRecords);
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: lookup.id,
      autoMerge: false,
    });
    await merge(restore.id);
    const restored = (await client.bases.get({ baseId: base.id })).fields.find(
      (field) => field.id === lookup.id,
    );
    expect(restored?.options).toEqual(lookup.options);
    expect((await client.records.get({ recordId })).headCommit.payload.total).toBe(27);
    expect(await db.select().from(busabaseRecords)).toEqual(recordsBeforeRestore);
    expect(await db.select().from(busabaseRecordLinks)).toEqual(links);
  });

  it("ignores forged lookup values on record create and update", async () => {
    const { lookup, recordId } = await setup();
    const update = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { name: "Changed", total: 700 },
      autoMerge: false,
    });
    await merge(update.id);
    const record = await client.records.get({ recordId });
    expect(record.headCommit.payload.total).toBe(12);
    const db = await getDb();
    const [stored] = await db
      .select()
      .from(busabaseCommits)
      .where(eq(busabaseCommits.id, record.headCommitId));
    expect(stored?.payload).not.toHaveProperty(lookup.slug);
  });

  it("allows deleting invalid and missing-source lookups without resolving their source", async () => {
    for (const invalidOptions of [
      {},
      { lookup: { relationFieldSlug: "missing", targetFieldSlug: "gone", rollup: "sum" as const } },
    ]) {
      const { base, lookup } = await setup();
      const db = await getDb();
      await db
        .update(busabaseBaseFields)
        .set({ options: invalidOptions })
        .where(eq(busabaseBaseFields.id, lookup.id));
      await merge((await requestDelete(base.id, lookup.id)).id);
      expect(
        (await client.bases.get({ baseId: base.id })).fields.some(
          (field) => field.id === lookup.id,
        ),
      ).toBe(false);
    }
  });

  it("rejects deleting a lookup that is the record title", async () => {
    const { base, lookup } = await setup();
    const db = await getDb();
    await db
      .update(busabaseBaseFields)
      .set({ position: -1 })
      .where(eq(busabaseBaseFields.id, lookup.id));
    await expect(requestDelete(base.id, lookup.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Set another record title field before deleting this one.",
    });
  });

  it("can remove a lookup after its target source field was deleted", async () => {
    const { base, source, lookup } = await setup();
    const amount = source.fields.find((field) => field.slug === "amount");
    if (!amount) throw new Error("Missing amount field");
    await merge((await requestDelete(source.id, amount.id)).id);
    await merge((await requestDelete(base.id, lookup.id)).id);
    expect(
      (await client.bases.get({ baseId: base.id })).fields.some((field) => field.id === lookup.id),
    ).toBe(false);
  });

  it("preserves the existing restore behavior for ordinary fields", async () => {
    const { source } = await setup();
    const amount = source.fields.find((field) => field.slug === "amount");
    if (!amount) throw new Error("Missing amount field");
    await merge((await requestDelete(source.id, amount.id)).id);
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: source.id,
      fieldId: amount.id,
      autoMerge: false,
    });
    await merge(restore.id);
    expect(
      (await client.bases.get({ baseId: source.id })).fields.some(
        (field) => field.id === amount.id,
      ),
    ).toBe(true);
  });

  it("rejects current formula dependents at proposal and rechecks dependencies at merge", async () => {
    const { base, lookup } = await setup();
    const deletion = await requestDelete(base.id, lookup.id);
    await client.bases.createField({
      baseId: base.id,
      slug: "double",
      name: "Double",
      type: "formula",
      options: { formula: { expression: "{total} * 2" } },
    });
    await expect(requestDelete(base.id, lookup.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "lookup_has_formula_dependents", dependentFieldSlugs: ["double"] },
    });
    await expect(merge(deletion.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      data: { reason: "lookup_has_formula_dependents" },
    });
    expect(
      (await client.bases.get({ baseId: base.id })).fields.some((field) => field.id === lookup.id),
    ).toBe(true);
    const formula = (await client.bases.get({ baseId: base.id })).fields.find(
      (field) => field.slug === "double",
    );
    if (!formula) throw new Error("Missing formula");
    await merge((await requestDelete(base.id, formula.id)).id);
    await client.bases.createField({
      baseId: base.id,
      slug: "literal",
      name: "Literal",
      type: "formula",
      options: { formula: { expression: 'LEN("{total}")' } },
    });
    // A quoted string is not a formula reference. Failed merge stays retryable.
    await merge(deletion.id);
  });

  it("rechecks current system type when merging an old deletion request", async () => {
    const { base, lookup } = await setup();
    const deletion = await requestDelete(base.id, lookup.id);
    const db = await getDb();
    await db
      .update(busabaseBaseFields)
      .set({ type: "created_time" })
      .where(eq(busabaseBaseFields.id, lookup.id));
    await expect(requestDelete(base.id, lookup.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot delete system field: total",
    });
    await expect(merge(deletion.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot delete system field: total",
    });
  });

  it("keeps saved lookup filters restrictive while deleted and makes them work again on restore", async () => {
    const { base, lookup, recordId } = await setup();
    const viewRequest = await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      slug: "lookup-filter",
      name: "Lookup filter",
      config: {
        filters: [{ fieldId: lookup.id, fieldSlug: lookup.slug, operator: "equals", value: "12" }],
      },
      autoMerge: false,
    });
    const view = (await merge(viewRequest.id)).view;
    if (!view) throw new Error("Missing view");
    const scope = { baseId: base.id, viewId: view.id };
    expect((await client.records.listPage(scope)).records.map((record) => record.id)).toEqual([
      recordId,
    ]);
    await merge((await requestDelete(base.id, lookup.id)).id);
    expect((await client.records.listPage(scope)).records).toEqual([]);
    const [saved] = await (await getDb())
      .select()
      .from(busabaseViews)
      .where(eq(busabaseViews.id, view.id));
    expect(saved?.config.filters).toEqual(view.config.filters);
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: lookup.id,
      autoMerge: false,
    });
    await merge(restore.id);
    expect((await client.records.listPage(scope)).records.map((record) => record.id)).toEqual([
      recordId,
    ]);
  });

  it("pins legacy slug-only saved filters so reusing the slug cannot reactivate them", async () => {
    const { base, lookup } = await setup();
    const request = await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      slug: "legacy-lookup-filter",
      name: "Legacy lookup filter",
      config: { filters: [{ fieldSlug: "total", operator: "equals", value: "12" }] },
      autoMerge: false,
    });
    const view = (await merge(request.id)).view;
    if (!view) throw new Error("Missing view");
    const db = await getDb();
    const legacyFilters = [{ fieldSlug: "total", operator: "equals" as const, value: "12" }];
    await db
      .update(busabaseViews)
      .set({ config: { ...view.config, filters: legacyFilters } })
      .where(eq(busabaseViews.id, view.id));
    await merge((await requestDelete(base.id, lookup.id)).id);
    await client.bases.createField({
      baseId: base.id,
      slug: "total",
      name: "Replacement",
      type: "lookup",
      options: lookup.options,
    });
    const [saved] = await db.select().from(busabaseViews).where(eq(busabaseViews.id, view.id));
    expect(saved?.config.filters).toEqual([{ ...legacyFilters[0], fieldId: lookup.id }]);
    expect((await client.records.listPage({ baseId: base.id, viewId: view.id })).records).toEqual(
      [],
    );
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: lookup.id,
      autoMerge: false,
    });
    await expect(merge(restore.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("merges an existing queued lookup restore using the ordinary field lifecycle", async () => {
    const { base, lookup } = await setup();
    await merge((await requestDelete(base.id, lookup.id)).id);
    const db = await getDb();
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: lookup.id,
      autoMerge: false,
    });
    await merge(restore.id);
    const [field] = await db
      .select()
      .from(busabaseBaseFields)
      .where(eq(busabaseBaseFields.id, lookup.id));
    expect(field?.deletedAt).toBeNull();
    expect(
      (await client.bases.get({ baseId: base.id })).fields.some((item) => item.id === lookup.id),
    ).toBe(true);
  });
});
