import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Server-side view-filter push-down parity. `records.listPaged` may push a
 * filter down to SQL as a SUPERSET (the client `applyViewConfigToRecords` stays
 * the exact authority). These tests pin the contract: a pushed filter must never
 * drop a record the client would keep (no false negatives), and non-pushable
 * filters must not filter server-side at all (client narrows).
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Filter push-down parity — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filter-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-filter-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "leads",
      name: "Leads",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "note", name: "Note", type: "text", required: false, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
        { slug: "active", name: "Active", type: "checkbox", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records: [
        { name: "Acme", note: "hi", score: 10, active: true },
        { name: "Acme Corp", note: "", score: 20, active: false },
        { name: "acme inc", note: "yo", score: 30, active: true },
        { name: "Globex", note: "note", score: 40, active: false },
      ],
      message: "seed leads",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  type TestFilter = {
    fieldSlug: string;
    fieldType?: string;
    operator: "contains" | "equals" | "not_empty" | "is_empty" | "is_true" | "is_false";
    value?: unknown;
  };
  const namesFor = async (filters: TestFilter[]): Promise<string[]> => {
    const page = await client.records.listPaged({ baseId, limit: 100, filters });
    return page.records.map((record) => String(record.headCommit.fields.name)).sort();
  };

  it("text contains is case-insensitive and exact (no false negatives, no over-match)", async () => {
    const names = await namesFor([
      { fieldSlug: "name", fieldType: "text", operator: "contains", value: "acme" },
    ]);
    expect(names).toEqual(["Acme", "Acme Corp", "acme inc"]);
    expect(names).not.toContain("Globex");
  });

  it("text equals is pushed as a SUPERSET (keeps the exact match, client narrows)", async () => {
    const names = await namesFor([
      { fieldSlug: "name", fieldType: "text", operator: "equals", value: "acme" },
    ]);
    // Superset of the client's exact {"Acme"} — must include it, must not leak Globex.
    expect(names).toContain("Acme");
    expect(names).not.toContain("Globex");
  });

  it("number contains matches on the text projection", async () => {
    const names = await namesFor([
      { fieldSlug: "score", fieldType: "number", operator: "contains", value: "3" },
    ]);
    expect(names).toEqual(["acme inc"]); // score 30 is the only one containing "3"
  });

  it("not_empty excludes the empty-string projection", async () => {
    const names = await namesFor([{ fieldSlug: "note", fieldType: "text", operator: "not_empty" }]);
    expect(names).toEqual(["Acme", "Globex", "acme inc"]); // "Acme Corp" note is ""
  });

  it("checkbox is_true matches the boolean projection", async () => {
    const names = await namesFor([
      { fieldSlug: "active", fieldType: "checkbox", operator: "is_true" },
    ]);
    expect(names).toEqual(["Acme", "acme inc"]);
  });

  it("non-pushable filters (is_empty) do NOT filter server-side — client narrows", async () => {
    // is_empty is not pushed; the server must return the whole base (superset),
    // never a wrongly-narrowed set, so the client filter stays authoritative.
    const names = await namesFor([{ fieldSlug: "note", fieldType: "text", operator: "is_empty" }]);
    expect(names).toEqual(["Acme", "Acme Corp", "Globex", "acme inc"]);
  });

  it("no filters returns the whole base", async () => {
    const names = await namesFor([]);
    expect(names).toEqual(["Acme", "Acme Corp", "Globex", "acme inc"]);
  });
});
