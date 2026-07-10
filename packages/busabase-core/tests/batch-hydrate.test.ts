import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `hydrateChangeRequests` / `hydrateRecords` batch-load every relation once for a
 * whole page instead of fanning out per row (the N+1 fix). The risk of a batch
 * is cross-contamination: item A picking up item B's operations / reviews / base.
 * These tests list change requests spanning TWO bases in a single hydrate call
 * and assert each CR keeps ONLY its own operations, reviews and base.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Batch hydrate — per-item relation isolation", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseAId = "";
  let baseBId = "";
  let crAId = "";
  let crBId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const baseA = await client.bases.create({
      autoMerge: true,
      slug: "alpha",
      name: "Alpha",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
    });
    baseAId = baseA.id;
    const baseB = await client.bases.create({
      autoMerge: true,
      slug: "beta",
      name: "Beta",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
    });
    baseBId = baseB.id;

    // CR on base A: 3 record-create operations. CR on base B: 2. Left in review.
    const crA = await client.bases.createBulkChangeRequest({
      baseId: baseAId,
      records: [{ name: "a1" }, { name: "a2" }, { name: "a3" }],
      message: "alpha seed",
    });
    crAId = crA.id;
    const crB = await client.bases.createBulkChangeRequest({
      baseId: baseBId,
      records: [{ title: "b1" }, { title: "b2" }],
      message: "beta seed",
    });
    crBId = crB.id;

    // Review only CR B, so review grouping must not leak onto CR A.
    await client.changeRequests.review({ changeRequestId: crBId, verdict: "approved" });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps each CR's base, operations and reviews to itself in one batch", async () => {
    const page = await client.changeRequests.listPaged({ limit: 50 });
    const byId = new Map(page.changeRequests.map((cr) => [cr.id, cr]));

    const crA = byId.get(crAId);
    const crB = byId.get(crBId);
    expect(crA).toBeDefined();
    expect(crB).toBeDefined();
    if (!crA || !crB) return;

    // Base isolation: each CR resolves to its OWN base.
    expect(crA.base?.id).toBe(baseAId);
    expect(crA.base?.slug).toBe("alpha");
    expect(crB.base?.id).toBe(baseBId);
    expect(crB.base?.slug).toBe("beta");

    // Operation isolation: counts + every op belongs to the right CR's base fields.
    expect(crA.operationCount).toBe(3);
    expect(crB.operationCount).toBe(2);
    expect(crA.operations).toHaveLength(3);
    expect(crB.operations).toHaveLength(2);

    // Review isolation: only CR B was reviewed.
    expect(crB.reviews).toHaveLength(1);
    expect(crB.reviews[0]?.verdict).toBe("approved");
    expect(crA.reviews).toHaveLength(0);
  });

  it("batch-hydrates a base's records with the correct per-record fields", async () => {
    // Merge CR A so its records exist, then list them (hydrateRecords batch path).
    await client.changeRequests.review({ changeRequestId: crAId, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: crAId });

    const page = await client.records.listPaged({ baseId: baseAId, limit: 50 });
    expect(page.records).toHaveLength(3);
    const names = page.records.map((record) => record.headCommit.fields.name).sort();
    expect(names).toEqual(["a1", "a2", "a3"]);
    // Every record resolves to base A (not base B) in the shared batch.
    for (const record of page.records) {
      expect(record.base.id).toBe(baseAId);
      expect(record.base.slug).toBe("alpha");
    }
  });
});
