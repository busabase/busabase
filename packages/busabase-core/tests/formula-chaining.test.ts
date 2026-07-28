import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Integration coverage for the formula dependency graph: a formula field MAY
 * reference another formula field (chaining), computed in dependency-first
 * order in one record write; a cycle across formula fields is rejected at
 * field create/edit time, not discovered later as an infinite loop.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Formula chaining + dependency-graph cycle detection (real PGLite)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  const approveAndMerge = async (changeRequestId: string) =>
    client.changeRequests
      .review({ changeRequestId, verdict: "approved" })
      .then(() => client.changeRequests.merge({ changeRequestId }));

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-formula-chain-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-formula-chain-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      autoMerge: true,
      slug: "formula-chain-test",
      name: "Formula Chain Test",
      fields: [
        { slug: "base_price", name: "Base Price", type: "number" },
        { slug: "markup_pct", name: "Markup %", type: "number" },
        {
          slug: "price_with_markup",
          name: "Price With Markup",
          type: "formula",
          options: { formula: { expression: "ROUND({base_price} * (1 + {markup_pct} / 100), 2)" } },
        },
        {
          // Chained: references ANOTHER formula field, not a raw input field.
          slug: "price_with_tax",
          name: "Price With Tax",
          type: "formula",
          options: { formula: { expression: "ROUND({price_with_markup} * 1.08, 2)" } },
        },
      ],
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("computes a chained formula (formula referencing another formula) in one write", async () => {
    const record = await client.bases.createChangeRequest({
      baseId,
      fields: { base_price: 100, markup_pct: 20 },
      autoMerge: true,
    });
    expect(record.materialized).toBe(true);
    if (!record.materialized) throw new Error("expected materialized record");
    expect(record.headCommit.fields.price_with_markup).toBe(120);
    // 120 * 1.08 = 129.6
    expect(record.headCommit.fields.price_with_tax).toBe(129.6);
  });

  it("recomputes the whole chain correctly on update, not just the directly-edited field", async () => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields: { base_price: 50, markup_pct: 10 },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("expected materialized record");
    expect(created.headCommit.fields.price_with_markup).toBe(55);
    expect(created.headCommit.fields.price_with_tax).toBe(59.4);

    const updateCr = await client.records.changeRequest({
      operation: "update",
      recordId: created.id,
      fields: { base_price: 200 },
      autoMerge: false,
    });
    await approveAndMerge(updateCr.id);
    const updated = await client.records.get({ recordId: created.id });
    expect(updated.headCommit.fields.price_with_markup).toBe(220);
    expect(updated.headCommit.fields.price_with_tax).toBe(237.6);
  });

  it("rejects a field edit that would introduce a formula dependency cycle", async () => {
    const base = await client.bases.get({ baseId });
    const markupField = base?.fields.find((field) => field.slug === "price_with_markup");
    if (!markupField) throw new Error("expected price_with_markup field to exist");

    // Editing price_with_markup to reference price_with_tax (which already
    // references price_with_markup) closes a 2-field cycle.
    await expect(
      client.bases.fieldChangeRequest({
        operation: "update",
        baseId,
        fieldId: markupField.id,
        patch: { options: { formula: { expression: "{price_with_tax} + 1" } } },
      }),
    ).rejects.toThrow(/cycle/i);
  });

  it("still rejects a self-referencing formula field", async () => {
    await expect(
      client.bases.fieldChangeRequest({
        operation: "create",
        baseId,
        slug: "self_ref",
        name: "Self Ref",
        type: "formula",
        required: false,
        options: { formula: { expression: "{self_ref} + 1" } },
      }),
    ).rejects.toThrow(/cannot reference itself/i);
  });

  it("still rejects a formula referencing a field that doesn't exist", async () => {
    await expect(
      client.bases.fieldChangeRequest({
        operation: "create",
        baseId,
        slug: "bad_ref",
        name: "Bad Ref",
        type: "formula",
        required: false,
        options: { formula: { expression: "{does_not_exist} + 1" } },
      }),
    ).rejects.toThrow(/unknown field reference/i);
  });
});
