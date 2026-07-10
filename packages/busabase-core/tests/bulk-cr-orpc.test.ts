import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Bulk record creation: one change request carrying N `record_create` operations,
 * reviewed and merged as a single unit (the CR/operation/commit model is already
 * 1:N:N and merge applies all operations in one transaction). Exercised through the
 * real oRPC router.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Bulk record Change Request — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "leads",
      name: "Leads",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "email", name: "Email", type: "email", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("packs many record creates into ONE change request, then merges them together", async () => {
    const records = [
      { name: "Acme Corp", email: "ops@acme.test" },
      { name: "Globex", email: "hi@globex.test" },
      { name: "Initech", email: "tps@initech.test" },
    ];
    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Import 3 leads",
    });
    expect(cr.status).toBe("in_review");
    expect(cr.operationCount).toBe(3);

    // Nothing is visible until the single CR merges.
    const before = await client.records.list({ baseId, limit: 100 });
    expect(before.length).toBe(0);

    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestId: cr.id });
    expect(merged.changeRequest.mergeSummary.operationCount).toBe(3);

    const after = await client.records.list({ baseId, limit: 100 });
    expect(after.length).toBe(3);
    const names = after.map((r) => r.headCommit.fields.name).sort();
    expect(names).toEqual(["Acme Corp", "Globex", "Initech"]);
  });

  it("validates the whole batch up front — one bad record creates no change request", async () => {
    const queueBefore = await client.changeRequests.list({ limit: 100 });

    await expect(
      client.bases.createBulkChangeRequest({
        baseId,
        // Second row omits the required `name` field.
        records: [{ name: "Valid Co" }, { email: "missing-name@x.test" }],
      }),
    ).rejects.toThrow();

    const queueAfter = await client.changeRequests.list({ limit: 100 });
    expect(queueAfter.length).toBe(queueBefore.length);
  });

  it("rejects an empty batch (min 1)", async () => {
    await expect(client.bases.createBulkChangeRequest({ baseId, records: [] })).rejects.toThrow();
  });
});
