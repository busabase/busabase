import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  });
});
