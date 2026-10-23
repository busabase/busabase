import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { LOOKUP_SOURCE_LIMIT } from "busabase-contract/types";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseRecordLinks,
  busabaseRecords,
} from "../src/db/schema";
import { resolveLookupValues } from "../src/domains/base/logic/lookup-values";
import { mergeRecordSnapshots } from "../src/domains/dashboard/helpers/record-snapshots";
import { busabaseRouter } from "../src/router";

/**
 * Read-time resolution of `lookup` values, driven through the real oRPC router
 * against a real PGLite DB — the rollup unit tests (lookup-rollup.test.ts) only
 * cover the pure aggregation, not the relation hop, the link ordering, or the
 * `limit` truncation, all of which need actual records and link rows.
 *
 * Harness convention copied from boundary-p3.test.ts.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("lookup values resolved at read time", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lookup-resolve-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lookup-resolve-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok)
      throw Object.assign(new Error(result?.error ?? "Change request merge returned no result"), {
        code: result?.code,
        data: result?.data,
      });
    return result;
  };

  const createRecord = async (baseId: string, fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields,
      message: "Create",
      submittedBy: "agent",
      autoMerge: false,
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) throw new Error("expected a created record");
    return merged.record.id;
  };

  const readFields = async (recordId: string) => {
    const record = await client.records.get({ recordId });
    return record.headCommit.payload as Record<string, unknown>;
  };

  it("caps source details without truncating aggregates or dependency versions", async () => {
    const products = await client.bases.create({
      slug: "lk-many-products",
      name: "Many Products",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "price", name: "Price", type: "number" },
      ],
    });
    if ("status" in products) throw new Error("Expected BaseVO");
    const orders = await client.bases.create({
      slug: "lk-many-orders",
      name: "Many Orders",
      autoMerge: true,
      fields: [
        { slug: "ref", name: "Ref", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseSlug: products.slug, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "sum" },
          },
        },
        {
          slug: "first",
          name: "First",
          type: "lookup",
          options: {
            lookup: {
              relationFieldSlug: "items",
              targetFieldSlug: "price",
              rollup: "sum",
              limit: "first",
            },
          },
        },
        {
          slug: "prices",
          name: "Prices",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "values" },
          },
        },
      ],
    });
    if ("status" in orders) throw new Error("Expected BaseVO");
    const ids: string[] = [];
    for (let index = 0; index < LOOKUP_SOURCE_LIMIT + 1; index++)
      ids.push(await createRecord(products.id, { name: `Product ${index}`, price: 1 }));
    const orderId = await createRecord(orders.id, { ref: "MANY", items: ids });
    const before = await client.records.get({ recordId: orderId });
    expect(before.computedFields?.total.sources).toHaveLength(LOOKUP_SOURCE_LIMIT);
    expect(before.computedFields?.total.sourcesTruncated).toBe(true);
    expect(before.computedFields?.total.value).toBe(ids.length);
    expect(before.computedFields?.prices.value).toEqual(ids.map(() => 1));
    expect(before.computedFields?.prices.sources).toHaveLength(LOOKUP_SOURCE_LIMIT);
    expect(before.computedFields?.first.sourcesTruncated).toBe(false);
    expect(before.computedFields?.first.value).toBe(1);
    const change = await client.records.changeRequest({
      operation: "update",
      recordId: ids.at(-1) ?? "",
      fields: { price: 7 },
      message: "Beyond cap",
      author: "agent",
      autoMerge: false,
    });
    await approveAndMerge(change.id);
    const after = await client.records.get({ recordId: orderId });
    expect(after.computedFields?.total.value).toBe(ids.length + 6);
    expect(after.computedFields?.prices.value).toEqual([...ids.slice(0, -1).map(() => 1), 7]);
    expect(after.computedFields?.total.sources).toEqual(before.computedFields?.total.sources);
    expect(after.computedFields?.total.dependencyVersion).not.toBe(
      before.computedFields?.total.dependencyVersion,
    );
    expect(after.computedFields?.total.dependencyReadAt).toBeGreaterThan(
      before.computedFields?.total.dependencyReadAt ?? 0,
    );
    expect(
      mergeRecordSnapshots([
        { record: after, fetchedAt: 100 },
        { record: before, fetchedAt: 200 },
      ]),
    ).toEqual([after]);
    const listed = await client.records.list({ baseId: orders.id });
    expect(
      listed.records.find((item) => item.id === orderId)?.computedFields?.total.sources,
    ).toHaveLength(LOOKUP_SOURCE_LIMIT);
  });

  it("truncates to the first linked record when limit is `first`", async () => {
    const products = await client.bases.create({
      slug: "lk-products",
      name: "Products",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "price", name: "Price", type: "number", required: false },
      ],
    });
    if ("status" in products) throw new Error("Expected materialized BaseVO");

    const orders = await client.bases.create({
      slug: "lk-orders",
      name: "Orders",
      autoMerge: true,
      fields: [
        { slug: "ref", name: "Ref", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseSlug: "lk-products", multiple: true },
        },
        {
          slug: "all_prices",
          name: "All Prices",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "values" },
          },
        },
        {
          slug: "first_price",
          name: "First Price",
          type: "lookup",
          options: {
            lookup: {
              relationFieldSlug: "items",
              targetFieldSlug: "price",
              rollup: "values",
              limit: "first",
            },
          },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "price", rollup: "sum" },
          },
        },
        {
          slug: "first_total",
          name: "First Total",
          type: "lookup",
          options: {
            lookup: {
              relationFieldSlug: "items",
              targetFieldSlug: "price",
              rollup: "sum",
              limit: "first",
            },
          },
        },
      ],
    });
    if ("status" in orders) throw new Error("Expected materialized BaseVO");

    const widget = await createRecord(products.id, { name: "Widget", price: 10 });
    const gadget = await createRecord(products.id, { name: "Gadget", price: 25 });
    const orderId = await createRecord(orders.id, { ref: "ORD-1", items: [widget, gadget] });

    const fields = await readFields(orderId);
    // Link order is preserved, so "first" is the first LINKED record, not the
    // lowest value or an arbitrary row.
    expect(fields.all_prices).toEqual([10, 25]);
    expect(fields.first_price).toEqual([10]);
    expect(fields.total).toBe(35);
    expect(fields.first_total).toBe(10);
    const record = await client.records.get({ recordId: orderId });
    expect(record.computedFields?.total).toMatchObject({
      status: "ready",
      value: 35,
      sourceBaseId: products.id,
      sourceBaseSlug: products.slug,
      targetField: { slug: "price", type: "number" },
      sources: [
        { recordId: widget, title: "Widget", value: 10 },
        { recordId: gadget, title: "Gadget", value: 25 },
      ],
    });
  });

  it("a record with no links rolls up to 0 for count and null for sum", async () => {
    const orders = await client.bases.list({}).then((bases) => {
      const found = bases.find((base) => base.slug === "lk-orders");
      if (!found) throw new Error("expected lk-orders");
      return found;
    });
    const emptyId = await createRecord(orders.id, { ref: "ORD-EMPTY" });
    const fields = await readFields(emptyId);
    expect(fields.all_prices).toEqual([]);
    // Not 0 — nothing is linked, so the total is unknown, not zero.
    expect(fields.total).toBeNull();
    expect((await client.records.get({ recordId: emptyId })).computedFields?.total.status).toBe(
      "unlinked",
    );
  });

  // The user-chosen behaviour for a broken dependency: allow the destructive
  // operation, let the lookup go inert. What must NOT happen is a crash, or a
  // stale value that still looks authoritative.
  it("degrades to null — not stale data — when its relation hop is deleted", async () => {
    const base = await client.bases.create({
      slug: "lk-broken",
      name: "Broken",
      autoMerge: true,
      fields: [
        { slug: "ref", name: "Ref", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseSlug: "lk-products", multiple: true },
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
    if ("status" in base) throw new Error("Expected materialized BaseVO");

    const products = await client.bases
      .list({})
      .then((bases) => bases.find((item) => item.slug === "lk-products"));
    if (!products) throw new Error("expected lk-products");
    const anyProduct = await createRecord(products.id, { name: "Bolt", price: 7 });
    const recordId = await createRecord(base.id, { ref: "B-1", items: [anyProduct] });

    expect((await readFields(recordId)).total).toBe(7);

    // Drop the relation field the lookup hops through.
    const relationField = base.fields.find((field) => field.slug === "items");
    if (!relationField) throw new Error("expected the relation field");
    const deleteCr = await client.bases.fieldChangeRequest({
      autoMerge: false,
      operation: "delete",
      baseId: base.id,
      fieldId: relationField.id,
      submittedBy: "agent",
    });
    await approveAndMerge(deleteCr.id);

    // The lookup is now unresolvable. It must simply not appear — reading the
    // record still works, and no stale 7 is left behind pretending to be current.
    const after = await readFields(recordId);
    expect(after.total ?? null).toBeNull();
    expect((await client.records.get({ recordId })).computedFields?.total).toMatchObject({
      status: "invalid",
      reason: "missing_relation",
    });
  });

  it("explains only authorized configuration failures without changing legacy statuses", async () => {
    const source = await client.bases.create({
      slug: "reason-source",
      name: "Reason source",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "amount", name: "Amount", type: "number" },
      ],
    });
    const base = await client.bases.create({
      slug: "reason-target",
      name: "Reason target",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseId: source.id, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "amount", rollup: "sum" },
          },
        },
      ],
    });
    if ("status" in base || "status" in source) throw new Error("Expected BaseVO");
    const id = await createRecord(base.id, { name: "Reasons" });
    const db = await getDb();
    const total = base.fields.find((field) => field.slug === "total");
    const relation = base.fields.find((field) => field.slug === "items");
    if (!total?.options.lookup || !relation) throw new Error("Expected Lookup and relation");
    const config = total.options.lookup;
    const check = async (fields: typeof base.fields, reason: string) => {
      const resolved = await resolveLookupValues(
        db,
        [{ id, baseId: base.id }],
        new Map([[base.id, { ...base, fields }]]),
      );
      expect(resolved.get(id)?.computedFields.total).toMatchObject({
        status: "invalid",
        reason,
        value: null,
        sources: [],
      });
      expect(resolved.get(id)?.computedFields.total.targetField).toBeUndefined();
    };
    await check([relation, { ...total, options: {} }], "missing_configuration");
    await check([total], "missing_relation");
    await check([{ ...relation, options: {} }, total], "missing_source_configuration");
    await check(
      [relation, { ...total, options: { lookup: { ...config, targetFieldSlug: "removed" } } }],
      "missing_target_field",
    );
    await check(
      [relation, { ...total, options: { lookup: { ...config, targetFieldSlug: "name" } } }],
      "unsupported_rollup",
    );
    const amount = source.fields.find((field) => field.slug === "amount");
    if (!amount) throw new Error("Expected source amount");
    await db
      .update(busabaseBaseFields)
      .set({ type: "lookup" })
      .where(eq(busabaseBaseFields.id, amount.id));
    await check(base.fields, "unsupported_source");
    await db
      .update(busabaseBaseFields)
      .set({ type: "number" })
      .where(eq(busabaseBaseFields.id, amount.id));
  });

  it("diagnoses visible archived or wrong-Base sources but hides mixed private identities", async () => {
    const source = await client.bases.create({
      slug: "diagnostic-source",
      name: "Diagnostic source",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        { slug: "amount", name: "Amount", type: "number" },
      ],
    });
    const other = await client.bases.create({
      slug: "diagnostic-other",
      name: "Diagnostic other",
      autoMerge: true,
      fields: [{ slug: "name", name: "Name", type: "text", required: true }],
    });
    const base = await client.bases.create({
      slug: "diagnostic-destination",
      name: "Diagnostic destination",
      autoMerge: true,
      fields: [
        { slug: "name", name: "Name", type: "text", required: true },
        {
          slug: "items",
          name: "Items",
          type: "relation",
          options: { targetBaseId: source.id, multiple: true },
        },
        {
          slug: "total",
          name: "Total",
          type: "lookup",
          options: {
            lookup: { relationFieldSlug: "items", targetFieldSlug: "amount", rollup: "sum" },
          },
        },
      ],
    });
    if ("status" in base || "status" in source || "status" in other)
      throw new Error("Expected BaseVO");
    const first = await createRecord(source.id, { name: "Train", amount: 12 });
    const second = await createRecord(source.id, { name: "Hotel", amount: 20 });
    const foreign = await createRecord(other.id, { name: "Private label must never leak" });
    const id = await createRecord(base.id, { name: "Trip", items: [first, second] });
    const db = await getDb();
    // Model a residual active relation from legacy/imported anomalous data.
    // Ordinary API archive soft-deletes inbound links and remains unlinked.
    await db
      .update(busabaseRecords)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(busabaseRecords.id, first));
    const archived = await client.records.get({ recordId: id });
    expect(archived.computedFields?.total).toMatchObject({
      status: "invalid",
      reason: "source_record_archived",
      value: null,
      sources: [],
    });
    expect(archived.computedFields?.total.targetField).toBeUndefined();
    const beforeVersion = archived.computedFields?.total.dependencyVersion;
    await db
      .update(busabaseRecords)
      .set({ status: "active", archivedAt: null })
      .where(eq(busabaseRecords.id, first));
    // Deliberately corrupt one relation identity: public APIs correctly reject this data.
    const link = and(
      eq(busabaseRecordLinks.sourceRecordId, id),
      eq(busabaseRecordLinks.targetRecordId, first),
    );
    await db.update(busabaseRecordLinks).set({ targetRecordId: foreign }).where(link);
    const mismatch = await client.records.get({ recordId: id });
    expect(mismatch.computedFields?.total).toMatchObject({
      status: "invalid",
      reason: "source_base_mismatch",
      value: null,
      sources: [],
    });
    expect(mismatch.computedFields?.total.dependencyVersion).not.toBe(beforeVersion);
    expect(JSON.stringify(mismatch.computedFields)).not.toContain("Private label");
    await client.nodes.updateVisibility({ nodeId: base.nodeId, visibility: "workspace" });
    await client.nodes.updateVisibility({ nodeId: source.nodeId, visibility: "workspace" });
    await client.nodes.updateVisibility({ nodeId: other.nodeId, visibility: "private" });
    const reader = () =>
      runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: "usr_reason_reader",
          permissionLevel: "read",
          isSpaceManager: false,
        },
        () => client.records.get({ recordId: id }),
      );
    const hidden = (await reader()).computedFields?.total;
    expect(hidden).toMatchObject({ status: "inaccessible", value: null, sources: [] });
    expect(hidden?.reason).toBeUndefined();
    expect(hidden?.targetField).toBeUndefined();
    expect(hidden?.sourceBaseId).toBeUndefined();
    // An archived visible record must not override an unknown/unauthorized identity.
    await db
      .update(busabaseRecords)
      .set({ status: "archived", archivedAt: new Date() })
      .where(eq(busabaseRecords.id, second));
    const mixed = (await reader()).computedFields?.total;
    expect(mixed?.status).toBe("inaccessible");
    expect(mixed?.reason).toBeUndefined();
    // Missing and private Base references have the same entire public computed response.
    const relation = base.fields.find((field) => field.slug === "items");
    if (!relation) throw new Error("Expected relation");
    const resolveWith = (targetBaseId: string) =>
      runWithBusabaseContext(
        {
          spaceId: LOCAL_SPACE_ID,
          actorId: "usr_reason_reader",
          permissionLevel: "read",
          isSpaceManager: false,
        },
        async () =>
          (
            await resolveLookupValues(
              db,
              [{ id, baseId: base.id }],
              new Map([
                [
                  base.id,
                  {
                    ...base,
                    fields: base.fields.map((field) =>
                      field.id === relation.id
                        ? { ...field, options: { ...field.options, targetBaseId } }
                        : field,
                    ),
                  },
                ],
              ]),
              123,
            )
          ).get(id)?.computedFields.total,
      );
    const privateBase = await resolveWith(other.id);
    await db
      .update(busabaseBases)
      .set({ deletedAt: new Date() })
      .where(eq(busabaseBases.id, other.id));
    const deletedBase = await resolveWith(other.id);
    expect(deletedBase).toEqual(privateBase);
    await db
      .update(busabaseBases)
      .set({ deletedAt: null, archivedAt: new Date() })
      .where(eq(busabaseBases.id, other.id));
    const archivedBase = await resolveWith(other.id);
    expect(archivedBase).toEqual(privateBase);
    await db.update(busabaseBases).set({ archivedAt: null }).where(eq(busabaseBases.id, other.id));
    const absentBase = await resolveWith("does-not-exist");
    expect(privateBase?.reason).toBeUndefined();
    const publicShape = (value: typeof privateBase) => {
      if (!value) throw new Error("Expected computed result");
      const { dependencyVersion: _version, ...shape } = value;
      return shape;
    };
    expect(publicShape(privateBase)).toEqual(publicShape(absentBase));
    await client.nodes.updateVisibility({ nodeId: other.nodeId, visibility: "workspace" });
  });

  it("uses current merged heads and formatting without rewriting source history", async () => {
    const bases = await client.bases.list({});
    const products = bases.find((base) => base.slug === "lk-products");
    const orders = bases.find((base) => base.slug === "lk-orders");
    if (!products || !orders) throw new Error("expected lookup fixtures");
    const productId = await createRecord(products.id, { name: "Fresh", price: 8 });
    const orderId = await createRecord(orders.id, { ref: "FRESH", items: [productId] });
    const before = await client.records.get({ recordId: orderId });
    const draft = await client.records.changeRequest({
      operation: "update",
      recordId: productId,
      fields: { name: "Fresh", price: 12 },
      message: "Draft price",
      author: "agent",
      autoMerge: false,
    });
    expect((await readFields(orderId)).total).toBe(8);
    await approveAndMerge(draft.id);
    const after = await client.records.get({ recordId: orderId });
    expect(after.headCommit.payload.total).toBe(12);
    expect(after.headCommitId).toBe(before.headCommitId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.computedFields?.total.dependencyVersion).not.toBe(
      before.computedFields?.total.dependencyVersion,
    );
    const price = products.fields.find((field) => field.slug === "price");
    if (!price) throw new Error("expected price field");
    const format = await client.bases.fieldChangeRequest({
      baseId: products.id,
      fieldId: price.id,
      operation: "update",
      patch: { options: { number: { format: "currency", currency: "EUR" } } },
      submittedBy: "agent",
      autoMerge: false,
    });
    await approveAndMerge(format.id);
    const formatted = await client.records.get({ recordId: orderId });
    expect(formatted.computedFields?.total.targetField?.options.number?.currency).toBe("EUR");
    expect(formatted.headCommitId).toBe(before.headCommitId);
    expect(formatted.computedFields?.total.dependencyVersion).not.toBe(
      after.computedFields?.total.dependencyVersion,
    );
  });

  it("distinguishes linked empty values and suppresses every hidden source value and identity", async () => {
    const bases = await client.bases.list({});
    const products = bases.find((base) => base.slug === "lk-products");
    const orders = bases.find((base) => base.slug === "lk-orders");
    if (!products || !orders) throw new Error("expected lookup fixtures");
    const productId = await createRecord(products.id, { name: "Secret product" });
    const orderId = await createRecord(orders.id, { ref: "SECRET", items: [productId] });
    const empty = await client.records.get({ recordId: orderId });
    expect(empty.computedFields?.total.status).toBe("empty");
    await client.nodes.updateVisibility({ nodeId: orders.nodeId, visibility: "workspace" });
    await client.nodes.updateVisibility({ nodeId: products.nodeId, visibility: "private" });
    const hidden = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "usr_lookup_reader",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      () => client.records.get({ recordId: orderId }),
    );
    expect(hidden.headCommit.payload.total).toBeNull();
    expect(hidden.computedFields?.total).toMatchObject({
      status: "inaccessible",
      value: null,
      sources: [],
    });
    expect(hidden.computedFields?.total.targetField).toBeUndefined();
    expect(hidden.computedFields?.total.sourceBaseId).toBeUndefined();
    expect(hidden.computedFields?.total.sourceBaseSlug).toBeUndefined();
    expect(JSON.stringify(hidden.computedFields)).not.toContain("Secret product");
    await client.nodes.updateVisibility({ nodeId: products.nodeId, visibility: "workspace" });
  });
});
