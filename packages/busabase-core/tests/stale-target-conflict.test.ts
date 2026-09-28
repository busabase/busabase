/**
 * A row that goes away underneath a pending change request must leave the
 * reviewer somewhere to go.
 *
 * Before this, the merge guard threw a plain CONFLICT: the batch was correctly
 * refused and nothing half-applied, but the change request stayed at
 * "approved · ready to merge" with the Merge button live, and the banner said
 * only "Cannot update an archived record" — naming none of the N rows on
 * screen. The reviewer's only available action was the one that could not work.
 *
 * So these assert the two things that make it actionable: the CR leaves the
 * mergeable state, and `mergeSummary.conflict` says WHICH row and why.
 *
 * Runs against a real PGLite database through the real router, because the
 * behaviour under test is a merge-time guard plus a persisted status.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const conflictOf = (changeRequest: { mergeSummary?: unknown } | null | undefined) =>
  (changeRequest?.mergeSummary as { conflict?: Record<string, unknown> } | undefined)?.conflict;

describe("stale target — a pinned row that went away", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-stale-target-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-stale-target-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "stale-target-batch",
      name: "Stale Target Batch",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
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

  const createRecord = async (name: string) => {
    const result = await client.bases.createChangeRequest({
      baseId,
      fields: { name },
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

  it("archived: refuses the merge, leaves the mergeable state, and names the row", async () => {
    const keep = await createRecord("Keeper");
    const doomed = await createRecord("Archived out from under us");

    // One batch touching BOTH rows — which is the whole reason the reviewer has
    // to be told which of the two is the problem.
    const batch = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        { recordId: keep.id, fields: { name: "Keeper edited" } },
        { recordId: doomed.id, fields: { name: "Doomed edited" } },
      ],
      message: "Edit two rows",
      autoMerge: false,
    });
    expect(batch.operationCount).toBe(2);

    // Somebody archives one of the pinned rows while the batch waits.
    const archive = await client.records.changeRequest({
      operation: "delete",
      recordId: doomed.id,
      autoMerge: true,
    });
    expect(archive).toBeTruthy();

    const merged = await approveAndMerge(batch.id);
    expect(merged).toMatchObject({ ok: false });
    expect(String(merged?.error)).toMatch(/archived record/i);

    const after = await client.changeRequests.get({ changeRequestId: batch.id });
    // `conflict` is the status whose review panel drops the Merge button and
    // offers Close instead — this is what ends the retry dead end.
    expect(after?.status).toBe("conflict");

    const conflict = conflictOf(after);
    expect(conflict).toMatchObject({ reason: "record_archived", recordId: doomed.id });
    // …and it names the DOOMED row, not merely "some row".
    expect(conflict?.recordId).not.toBe(keep.id);

    // Still all-or-nothing: the untouched row kept its original value.
    const keepAfter = await client.records.get({ recordId: keep.id });
    expect(keepAfter.headCommit.payload.name).toBe("Keeper");
  });

  it("a plain field conflict keeps rendering as a field conflict", async () => {
    // Both kinds share `mergeSummary.conflict` and the panel picks its shape
    // from `reason`. A field conflict must NOT acquire one, or every
    // pre-existing conflicted CR would start claiming a row was archived.
    const record = await createRecord("Contended");

    const first = await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { name: "from first" },
      autoMerge: false,
    });
    const second = await client.records.changeRequest({
      operation: "update",
      recordId: record.id,
      fields: { name: "from second" },
      autoMerge: false,
    });

    await approveAndMerge(first.id);
    const secondResult = await approveAndMerge(second.id);
    expect(secondResult).toMatchObject({ ok: false });

    const after = await client.changeRequests.get({ changeRequestId: second.id });
    expect(after?.status).toBe("conflict");
    const conflict = conflictOf(after);
    expect(conflict?.reason).toBeUndefined();
    expect(Array.isArray(conflict?.fields)).toBe(true);
  });
});
