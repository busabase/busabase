import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb, getPgliteClient } from "../src/db";
import * as schema from "../src/db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecords,
  busabaseViews,
} from "../src/db/schema";
import { isSystemFieldType } from "../src/domains/base/field-types";
import { assertFieldDeletable } from "../src/domains/base/logic/field-deletion";
import { lockLookupMergeTargets } from "../src/domains/base/logic/lookup-merge-targets";
import { isDeletableFieldType } from "../src/domains/base/utils/field-capabilities";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("formula field deletion through oRPC and real PGlite", () => {
  let client: Client;
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let sequence = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "formula-field-delete-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "formula-field-delete-storage-"));
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

  const setup = async () => {
    const base = await client.bases.create({
      slug: `formula-delete-${++sequence}`,
      name: "Formula source",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "quantity", name: "Quantity", type: "number" },
        {
          slug: "total",
          name: "Total",
          type: "formula",
          options: { formula: { expression: "{quantity} * 10" } },
        },
      ],
    });
    const formula = base.fields.find((field) => field.slug === "total");
    if (!formula) throw new Error("Missing formula field");
    return { base, formula };
  };

  const createRecord = async (baseId: string, quantity = 2) => {
    const request = await client.bases.createChangeRequest({
      baseId,
      fields: { name: "Row", quantity, total: 900 },
      autoMerge: false,
    });
    const result = await merge(request.id);
    if (!result.record) throw new Error("Expected record");
    return result.record.id;
  };
  const requestDelete = (baseId: string, fieldId: string) =>
    client.bases.fieldChangeRequest({ operation: "delete", baseId, fieldId, autoMerge: false });
  const lookupBase = async (sourceId: string) =>
    client.bases.create({
      slug: `formula-consumer-${++sequence}`,
      name: "Consumer",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text" },
        {
          slug: "source",
          name: "Source",
          type: "relation",
          options: { targetBaseId: sourceId, multiple: true },
        },
        {
          slug: "sum",
          name: "Sum",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "source", targetFieldSlug: "total", rollup: "sum" },
          },
        },
      ],
    });

  it("allows formula definitions to be deleted while their values remain server-managed", async () => {
    expect(isDeletableFieldType("formula")).toBe(true);
    expect(isSystemFieldType("formula")).toBe(true);
    const { base } = await setup();
    const recordId = await createRecord(base.id);
    expect((await client.records.get({ recordId })).headCommit.payload.total).toBe(20);
    const update = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { quantity: 3, total: 800 },
      autoMerge: false,
    });
    await merge(update.id);
    expect((await client.records.get({ recordId })).headCommit.payload.total).toBe(30);
  });

  it("deletes without record backfills and restores the same formula against current inputs", async () => {
    const { base, formula } = await setup();
    const recordId = await createRecord(base.id);
    const db = await getDb();
    const records = await db.select().from(busabaseRecords);
    const deletion = await requestDelete(base.id, formula.id);
    const commits = await db.select().from(busabaseCommits);
    await merge(deletion.id);
    expect(
      (await client.bases.get({ baseId: base.id })).fields.some((field) => field.id === formula.id),
    ).toBe(false);
    const deletedValues = await db
      .select()
      .from(busabaseFieldValues)
      .where(eq(busabaseFieldValues.fieldId, formula.id));
    expect(deletedValues.length).toBeGreaterThan(0);
    expect(deletedValues.every((value) => value.deletedAt !== null)).toBe(true);
    expect(await db.select().from(busabaseRecords)).toEqual(records);
    expect(await db.select().from(busabaseCommits)).toEqual(commits);
    const update = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { quantity: 7 },
      autoMerge: false,
    });
    await merge(update.id);
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: formula.id,
      autoMerge: false,
    });
    await merge(restore.id);
    const restored = (await client.bases.get({ baseId: base.id })).fields.find(
      (field) => field.id === formula.id,
    );
    expect(restored?.options).toEqual(formula.options);
    expect((await client.records.get({ recordId })).headCommit.payload).toMatchObject({
      quantity: 7,
      total: 70,
    });
  });

  it("lets invalid, missing-input, and self-referencing formulas be cleaned up without computing", async () => {
    for (const expression of ["not a valid expression (", "{missing} * 2", "{total} + 1"]) {
      const { base, formula } = await setup();
      const db = await getDb();
      await db
        .update(busabaseBaseFields)
        .set({ options: { formula: { expression } } })
        .where(eq(busabaseBaseFields.id, formula.id));
      await merge((await requestDelete(base.id, formula.id)).id);
      expect(
        (await client.bases.get({ baseId: base.id })).fields.some(
          (field) => field.id === formula.id,
        ),
      ).toBe(false);
    }
  });

  it("protects primary and built-in system fields", async () => {
    const { base, formula } = await setup();
    const db = await getDb();
    await db
      .update(busabaseBaseFields)
      .set({ position: -1 })
      .where(eq(busabaseBaseFields.id, formula.id));
    await expect(requestDelete(base.id, formula.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Set another record title field before deleting this one.",
    });
    await db
      .update(busabaseBaseFields)
      .set({ position: 2, type: "created_time" })
      .where(eq(busabaseBaseFields.id, formula.id));
    await expect(requestDelete(base.id, formula.id)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot delete system field: total",
    });
  });

  it("blocks downstream formulas at proposal and merge, and proceeds after deleting the dependent", async () => {
    const { base, formula } = await setup();
    const deletion = await requestDelete(base.id, formula.id);
    await client.bases.createField({
      baseId: base.id,
      slug: "tax",
      name: "Tax",
      type: "formula",
      options: { formula: { expression: "{total} * 0.1" } },
    });
    await expect(requestDelete(base.id, formula.id)).rejects.toMatchObject({
      data: { reason: "formula_has_dependents", dependentFieldSlugs: ["tax"] },
    });
    await expect(merge(deletion.id)).rejects.toMatchObject({
      data: { reason: "formula_has_dependents" },
    });
    const tax = (await client.bases.get({ baseId: base.id })).fields.find(
      (field) => field.slug === "tax",
    );
    if (!tax) throw new Error("Missing tax");
    await merge((await requestDelete(base.id, tax.id)).id);
    await merge(deletion.id);
  });

  it("blocks cross-Base lookup rollups at proposal and merge, using current relation metadata", async () => {
    const { base, formula } = await setup();
    const deletion = await requestDelete(base.id, formula.id);
    const consumer = await lookupBase(base.id);
    const sum = consumer.fields.find((field) => field.slug === "sum");
    if (!sum) throw new Error("Missing sum");
    await expect(requestDelete(base.id, formula.id)).rejects.toMatchObject({
      data: {
        reason: "formula_has_lookup_dependents",
        dependents: [
          { baseId: consumer.id, baseSlug: consumer.slug, fieldId: sum.id, fieldSlug: sum.slug },
        ],
        hasRestrictedDependents: false,
      },
    });
    await expect(merge(deletion.id)).rejects.toMatchObject({
      data: { reason: "formula_has_lookup_dependents" },
    });
    await merge((await requestDelete(consumer.id, sum.id)).id);
    await merge(deletion.id);
  });

  it("ignores deleted fields, archived/deleted Bases, and other spaces", async () => {
    for (const state of [
      "deleted-field",
      "archived-base",
      "deleted-base",
      "other-space",
    ] as const) {
      const { base, formula } = await setup();
      const consumer = await lookupBase(base.id);
      const sum = consumer.fields.find((field) => field.slug === "sum");
      if (!sum) throw new Error("Missing sum");
      const db = await getDb();
      if (state === "deleted-field")
        await db
          .update(busabaseBaseFields)
          .set({ deletedAt: new Date() })
          .where(eq(busabaseBaseFields.id, sum.id));
      else
        await db
          .update(busabaseBases)
          .set(
            state === "archived-base"
              ? { archivedAt: new Date() }
              : state === "deleted-base"
                ? { deletedAt: new Date() }
                : { spaceId: "other-space" },
          )
          .where(eq(busabaseBases.id, consumer.id));
      await merge((await requestDelete(base.id, formula.id)).id);
    }
  });

  it("rejects stale pending lookup creation after its source formula is deleted", async () => {
    const { base, formula } = await setup();
    const consumer = await client.bases.create({
      slug: `stale-lookup-${++sequence}`,
      name: "Consumer",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "source", name: "Source", type: "relation", options: { targetBaseId: base.id } },
      ],
    });
    const pending = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: consumer.id,
      slug: "sum",
      name: "Sum",
      type: "lookup",
      options: { lookup: { relationFieldSlug: "source", targetFieldSlug: "total" } },
      autoMerge: false,
    });
    await merge((await requestDelete(base.id, formula.id)).id);
    await expect(merge(pending.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "lookup_dependency_changed" },
    });
    expect(
      (await client.bases.get({ baseId: consumer.id })).fields.some(
        (field) => field.slug === "sum",
      ),
    ).toBe(false);
  });

  it("rejects stale pending inline Base creation without materializing a consumer", async () => {
    const { base, formula } = await setup();
    const slug = `stale-inline-${++sequence}`;
    const pending = await client.nodes.createChangeRequest({
      autoMerge: false,
      operations: [
        {
          kind: "create",
          nodeType: "base",
          slug,
          name: "Consumer",
          fields: [
            { slug: "name", name: "Name", type: "text" },
            {
              slug: "source",
              name: "Source",
              type: "relation",
              options: { targetBaseSlug: base.slug },
            },
            {
              slug: "sum",
              name: "Sum",
              type: "lookup",
              options: { lookup: { relationFieldSlug: "source", targetFieldSlug: "total" } },
            },
          ],
        },
      ],
    });
    await merge((await requestDelete(base.id, formula.id)).id);
    await expect(merge(pending.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "lookup_dependency_changed" },
    });
    expect((await client.bases.list({})).some((candidate) => candidate.slug === slug)).toBe(false);
  });

  it("preserves sequential same-request source creation and stable bindings through rename", async () => {
    const slug = `batch-source-${++sequence}`;
    const consumerSlug = `batch-consumer-${sequence}`;
    const created = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "base",
          slug,
          name: "Source",
          fields: [
            { slug: "name", name: "Name", type: "text" },
            {
              slug: "total",
              name: "Total",
              type: "formula",
              options: { formula: { expression: "10" } },
            },
          ],
        },
        {
          kind: "create",
          nodeType: "base",
          slug: consumerSlug,
          name: "Consumer",
          fields: [
            { slug: "name", name: "Name", type: "text" },
            { slug: "source", name: "Source", type: "relation", options: { targetBaseSlug: slug } },
            {
              slug: "sum",
              name: "Sum",
              type: "lookup",
              options: { lookup: { relationFieldSlug: "source", targetFieldSlug: "total" } },
            },
          ],
        },
      ],
    });
    expect(created.status).toBe("merged");
    const source = await client.bases.get({ baseId: slug });
    const consumer = await client.bases.get({ baseId: consumerSlug });
    expect(consumer.fields.find((field) => field.slug === "source")?.options.targetBaseId).toBe(
      source.id,
    );
    // An external source can be renamed after a new consumer is materialized in the same CR.
    const second = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "base",
          slug: `renamed-consumer-${++sequence}`,
          name: "Consumer",
          fields: [
            { slug: "name", name: "Name", type: "text" },
            { slug: "source", name: "Source", type: "relation", options: { targetBaseSlug: slug } },
            {
              slug: "sum",
              name: "Sum",
              type: "lookup",
              options: { lookup: { relationFieldSlug: "source", targetFieldSlug: "total" } },
            },
          ],
        },
        { kind: "rename", nodeId: source.nodeId, slug: `${slug}-renamed` },
      ],
    });
    expect(second.status).toBe("merged");
    const third = await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "rename", nodeId: source.nodeId, slug: `${slug}-again` },
        {
          kind: "create",
          nodeType: "base",
          slug: `renamed-first-consumer-${++sequence}`,
          name: "Consumer",
          fields: [
            { slug: "name", name: "Name", type: "text" },
            {
              slug: "source",
              name: "Source",
              type: "relation",
              options: { targetBaseSlug: `${slug}-again` },
            },
            {
              slug: "sum",
              name: "Sum",
              type: "lookup",
              options: { lookup: { relationFieldSlug: "source", targetFieldSlug: "total" } },
            },
          ],
        },
      ],
    });
    expect(third.status).toBe("merged");
  });

  it("restores lookup fields only against a still-existing source", async () => {
    const { base, formula } = await setup();
    const consumer = await lookupBase(base.id);
    const lookup = consumer.fields.find((field) => field.slug === "sum");
    if (!lookup) throw new Error("Missing lookup");
    await merge((await requestDelete(consumer.id, lookup.id)).id);
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: consumer.id,
      fieldId: lookup.id,
      autoMerge: false,
    });
    await merge((await requestDelete(base.id, formula.id)).id);
    await expect(merge(restore.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "lookup_dependency_changed" },
    });
    await merge(
      (
        await client.bases.fieldChangeRequest({
          operation: "restore",
          baseId: base.id,
          fieldId: formula.id,
          autoMerge: false,
        })
      ).id,
    );
    await merge(restore.id);
    expect(
      (await client.bases.get({ baseId: consumer.id })).fields.some(
        (field) => field.id === lookup.id,
      ),
    ).toBe(true);
  });

  it("does not add metadata SQL to unrelated record operations", async () => {
    const { base } = await setup();
    await createRecord(base.id);
    const db = await getDb();
    const operations = (await db.select().from(schema.busabaseOperations)).filter(
      (operation) => operation.operation === "record_create",
    );
    const queries: string[] = [];
    const observedDb = drizzle(await getPgliteClient(), {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await runWithBusabaseContext(
      { db: observedDb, spaceId: LOCAL_SPACE_ID, isSpaceManager: true },
      async () => {
        const commits = new Map(
          (await db.select().from(busabaseCommits)).map((commit) => [commit.id, commit]),
        );
        await lockLookupMergeTargets(observedDb, operations, commits, []);
      },
    );
    expect(operations.length).toBeGreaterThan(0);
    expect(queries).toEqual([]);
  });

  it("blocks restricted lookup dependencies without leaking their IDs or names", async () => {
    const { base, formula } = await setup();
    const consumer = await lookupBase(base.id);
    const db = await getDb();
    await db
      .update(busabaseNodes)
      .set({ effectiveVisibility: "private" })
      .where(eq(busabaseNodes.id, consumer.nodeId));
    const error = await runWithBusabaseContext(
      { spaceId: LOCAL_SPACE_ID, actorId: "ordinary-member", isSpaceManager: false },
      async () => {
        try {
          await requestDelete(base.id, formula.id);
          return null;
        } catch (error) {
          return error;
        }
      },
    );
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      data: {
        reason: "formula_has_lookup_dependents",
        dependents: [],
        hasRestrictedDependents: true,
      },
    });
    expect(JSON.stringify(error)).not.toContain(consumer.id);
    expect(JSON.stringify(error)).not.toContain(consumer.slug);
  });

  it("preserves flat and grouped saved filters through deletion and restore", async () => {
    for (const grouped of [false, true]) {
      const { base, formula } = await setup();
      const recordId = await createRecord(base.id);
      const leaf = {
        fieldSlug: "total",
        fieldId: formula.id,
        operator: "equals" as const,
        value: "20",
      };
      const view = (
        await merge(
          (
            await client.views.changeRequest({
              operation: "create",
              baseId: base.id,
              slug: "formula-filter",
              name: "Formula filter",
              config: { filters: grouped ? [{ conjunction: "and", conditions: [leaf] }] : [leaf] },
              autoMerge: false,
            })
          ).id,
        )
      ).view;
      if (!view) throw new Error("Missing view");
      const scope = { baseId: base.id, viewId: view.id };
      expect((await client.records.listPage(scope)).records.map((record) => record.id)).toEqual([
        recordId,
      ]);
      await merge((await requestDelete(base.id, formula.id)).id);
      expect((await client.records.listPage(scope)).records).toEqual([]);
      const [stored] = await (await getDb())
        .select()
        .from(busabaseViews)
        .where(eq(busabaseViews.id, view.id));
      expect(stored?.config.filters).toEqual(view.config.filters);
      await merge(
        (
          await client.bases.fieldChangeRequest({
            operation: "restore",
            baseId: base.id,
            fieldId: formula.id,
            autoMerge: false,
          })
        ).id,
      );
      expect((await client.records.listPage(scope)).records.map((record) => record.id)).toEqual([
        recordId,
      ]);
    }
  });

  it("retains ordinary slug collision protection when restoring a deleted formula", async () => {
    const { base, formula } = await setup();
    await merge((await requestDelete(base.id, formula.id)).id);
    await client.bases.createField({
      baseId: base.id,
      slug: "total",
      name: "Replacement",
      type: "number",
    });
    const restore = await client.bases.fieldChangeRequest({
      operation: "restore",
      baseId: base.id,
      fieldId: formula.id,
      autoMerge: false,
    });
    await expect(merge(restore.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("checks only metadata in a constant number of real SQL queries independent of records", async () => {
    const { base, formula } = await setup();
    const queries: string[] = [];
    const observedDb = drizzle(await getPgliteClient(), {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    const check = () =>
      runWithBusabaseContext(
        { db: observedDb, spaceId: LOCAL_SPACE_ID, isSpaceManager: true },
        () => assertFieldDeletable(observedDb, { ...formula, baseId: base.id }),
      );
    await check();
    expect(queries).toHaveLength(2);
    expect(
      queries.every(
        (query) => !/busabase_records|busabase_commits|busabase_field_values|count\(/i.test(query),
      ),
    ).toBe(true);
    for (let index = 0; index < 5; index++) await createRecord(base.id, index);
    queries.length = 0;
    await check();
    expect(queries).toHaveLength(2);
    expect(
      queries.every(
        (query) => !/busabase_records|busabase_commits|busabase_field_values|count\(/i.test(query),
      ),
    ).toBe(true);
  });
});
