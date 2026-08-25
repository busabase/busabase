import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseCommits } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("bulk record update ChangeRequest — oRPC integration", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";
  let otherBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-update-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-update-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "bulk-update-records",
      name: "Bulk Update Records",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "email", name: "Email", type: "email", options: {} },
        { slug: "note", name: "Note", type: "text", options: {} },
      ],
      autoMerge: true,
    });
    const other = await client.bases.create({
      slug: "bulk-update-other",
      name: "Bulk Update Other",
      fields: [{ slug: "name", name: "Name", type: "text", options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
    otherBaseId = other.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const createRecord = async (targetBaseId: string, fields: Record<string, unknown>) => {
    const result = await client.bases.createChangeRequest({
      baseId: targetBaseId,
      fields,
      autoMerge: true,
    });
    if (!result.materialized) throw new Error("Expected a materialized record");
    return result;
  };

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    return result;
  };

  it("creates one pending CR, then atomically applies partial updates and null clears", async () => {
    const first = await createRecord(baseId, {
      name: "Acme",
      email: "ops@acme.test",
      note: "keep",
    });
    const second = await createRecord(baseId, {
      name: "Globex",
      email: "hi@globex.test",
      note: "clear",
    });

    const cr = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        { recordId: first.id, fields: { email: "new@acme.test" } },
        { recordId: second.id, fields: { note: null } },
      ],
      message: "Refresh two leads",
      autoMerge: false,
    });
    expect(cr.status).toBe("in_review");
    expect(cr.operationCount).toBe(2);
    expect((await client.records.get({ recordId: first.id })).headCommit.payload.email).toBe(
      "ops@acme.test",
    );
    expect((await client.records.get({ recordId: second.id })).headCommit.payload.note).toBe(
      "clear",
    );

    const merged = await approveAndMerge(cr.id);
    expect(merged?.ok).toBe(true);
    const firstAfter = await client.records.get({ recordId: first.id });
    const secondAfter = await client.records.get({ recordId: second.id });
    expect(firstAfter.headCommit.payload).toMatchObject({
      name: "Acme",
      email: "new@acme.test",
      note: "keep",
    });
    expect(secondAfter.headCommit.payload).toMatchObject({ name: "Globex", note: null });
  });

  it("rejects invalid, duplicate, cross-base, archived, and foreign base commits without a CR", async () => {
    const record = await createRecord(baseId, { name: "Validation target" });
    const sibling = await createRecord(baseId, { name: "Sibling" });
    const foreign = await createRecord(otherBaseId, { name: "Foreign" });
    const archived = await createRecord(baseId, { name: "Archived" });
    const archiveCr = await client.records.changeRequest({
      operation: "delete",
      recordId: archived.id,
    });
    expect((await approveAndMerge(archiveCr.id))?.ok).toBe(true);

    const countBefore = (await client.changeRequests.list({ limit: 100 })).changeRequests.length;
    const attempts = [
      client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [{ recordId: record.id, fields: { name: null } }],
        autoMerge: false,
      }),
      client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [
          { recordId: record.id, fields: { note: "one" } },
          { recordId: record.id, fields: { note: "two" } },
        ],
      }),
      client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [{ recordId: foreign.id, fields: { name: "Wrong base" } }],
      }),
      client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [{ recordId: archived.id, fields: { name: "No" } }],
      }),
      client.bases.createBulkUpdateChangeRequest({
        baseId,
        updates: [
          {
            recordId: record.id,
            fields: { note: "Injected" },
            baseCommitId: sibling.headCommit.id,
          },
        ],
      }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow();
    expect((await client.changeRequests.list({ limit: 100 })).changeRequests.length).toBe(
      countBefore,
    );
  });

  it("dedupes retries and supports explicit auto-merge", async () => {
    const record = await createRecord(baseId, { name: "Retry me" });
    const input = {
      baseId,
      updates: [{ recordId: record.id, fields: { note: "once" } }],
      idempotencyKey: `bulk-update-${record.id}`,
      autoMerge: false as const,
    };
    const first = await client.bases.createBulkUpdateChangeRequest(input);
    const retry = await client.bases.createBulkUpdateChangeRequest(input);
    expect(retry.id).toBe(first.id);

    const auto = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [{ recordId: record.id, fields: { name: "Auto merged" } }],
      autoMerge: true,
    });
    expect(auto.status).toBe("merged");
    expect((await client.records.get({ recordId: record.id })).headCommit.payload.name).toBe(
      "Auto merged",
    );
  });

  it("rolls back every record when one same-field update conflicts", async () => {
    const first = await createRecord(baseId, { name: "Conflict A", note: "old-a" });
    const second = await createRecord(baseId, { name: "Conflict B", note: "old-b" });
    const bulk = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        { recordId: first.id, fields: { note: "bulk-a" }, baseCommitId: first.headCommit.id },
        { recordId: second.id, fields: { note: "bulk-b" }, baseCommitId: second.headCommit.id },
      ],
      autoMerge: false,
    });
    await client.records.changeRequest({
      operation: "update",
      recordId: first.id,
      fields: { note: "concurrent-a" },
      autoMerge: true,
    });

    const result = await approveAndMerge(bulk.id);
    expect(result?.ok).toBe(false);
    expect((await client.records.get({ recordId: first.id })).headCommit.payload.note).toBe(
      "concurrent-a",
    );
    expect((await client.records.get({ recordId: second.id })).headCommit.payload.note).toBe(
      "old-b",
    );
  });

  it("three-way merges a concurrent change to a different field", async () => {
    const record = await createRecord(baseId, {
      name: "Three way",
      email: "old@example.test",
      note: "old note",
    });
    const bulk = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        {
          recordId: record.id,
          fields: { email: "new@example.test" },
          baseCommitId: record.headCommit.id,
        },
      ],
      autoMerge: false,
    });
    await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { note: "concurrent note" },
      autoMerge: true,
    });

    expect((await approveAndMerge(bulk.id))?.ok).toBe(true);
    expect((await client.records.get({ recordId: record.id })).headCommit.payload).toMatchObject({
      email: "new@example.test",
      note: "concurrent note",
    });
  });

  it("accepts a legacy ancestor base commit that has no operationId", async () => {
    const record = await createRecord(baseId, {
      name: "Legacy history",
      email: "before@example.test",
      note: "before note",
    });
    const db = await getDb();
    await db
      .update(busabaseCommits)
      .set({ operationId: null })
      .where(eq(busabaseCommits.id, record.headCommit.id));

    await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { note: "concurrent note" },
      autoMerge: true,
    });
    const bulk = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        {
          recordId: record.id,
          fields: { email: "after@example.test" },
          baseCommitId: record.headCommit.id,
        },
      ],
      autoMerge: false,
    });

    expect((await approveAndMerge(bulk.id))?.ok).toBe(true);
    expect((await client.records.get({ recordId: record.id })).headCommit.payload).toMatchObject({
      email: "after@example.test",
      note: "concurrent note",
    });
  });
});
