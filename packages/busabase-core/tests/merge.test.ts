import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Staleness-aware merge: when a record moved since a change request's base, the
 * merge does a git-style field-level 3-way merge instead of failing. Non-
 * overlapping fields auto-merge (the intervening edit is preserved); the same
 * field changed on both sides is a real conflict that blocks the merge.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Staleness-aware 3-way merge — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-merge-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-merge-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  const createRecord = async () => {
    const cr = await client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title: "orig title", body: "orig body", channel: "blog" },
      message: "Create",
      submittedBy: "agent",
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) {
      throw new Error("expected a created record");
    }
    return merged.record.id;
  };

  // NOTE: real callers normally submit only the fields they're actually
  // changing (a partial update — see record-update-partial-fields.test.ts for
  // the dedicated coverage of that path and the data-loss bug it used to hit).
  // This helper instead resubmits every field on every update so these
  // particular tests can assert 3-way merge / conflict detection in isolation
  // without also depending on the partial-submission fix.
  const proposeUpdate = (recordId: string, overrides: Record<string, unknown>) =>
    client.records.updateChangeRequest({
      recordId,
      fields: { title: "orig title", body: "orig body", channel: "blog", ...overrides },
    });

  it("auto-merges change requests that touch different fields", async () => {
    const recordId = await createRecord();
    // Two CRs from the same base, touching different fields.
    const bodyCr = await proposeUpdate(recordId, { body: "new body from A" });
    const titleCr = await proposeUpdate(recordId, { title: "new title from C" });

    // C lands first → the record moves.
    await approveAndMerge(titleCr.id);
    // A is now stale, but it only touched `body` → clean auto-merge.
    const merged = await approveAndMerge(bodyCr.id);

    expect(merged.record?.headCommit.fields.title).toBe("new title from C");
    expect(merged.record?.headCommit.fields.body).toBe("new body from A");
  });

  it("blocks the merge when the same field changed on both sides", async () => {
    const recordId = await createRecord();
    const titleCrC = await proposeUpdate(recordId, { title: "title from C" });
    const titleCrD = await proposeUpdate(recordId, { title: "title from D" });

    await approveAndMerge(titleCrC.id);
    // D also changed `title`, from the same base → genuine conflict.
    await client.changeRequests.review({
      changeRequestId: titleCrD.id,
      verdict: "approved",
    });
    await expect(client.changeRequests.merge({ changeRequestId: titleCrD.id })).rejects.toThrow(
      /Conflicting field.*title/,
    );
  });

  // Regression test for a real TOCTOU race: two near-simultaneous merge calls for
  // the same approved CR (e.g. a client retry after a timeout, or a double-click)
  // both read status="approved" before either commits. Without a DB-level guard,
  // both would proceed to re-run every operation (double-creating the record) and
  // the loser's failure could leave the CR corrupted instead of cleanly merged.
  it("serializes concurrent merge() calls on the same CR instead of double-executing", async () => {
    const cr = await client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title: "race title", body: "race body", channel: "blog" },
      message: "Create",
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });

    const results = await Promise.allSettled([
      client.changeRequests.merge({ changeRequestId: cr.id }),
      client.changeRequests.merge({ changeRequestId: cr.id }),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof client.changeRequests.merge>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    // Exactly one caller wins the race and gets a real merge result back.
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.record).toBeTruthy();

    // The other caller loses the race with a clear, distinct error — not a
    // record-content merge conflict (no field diff), just "someone else already
    // claimed this merge".
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toMatch(/already being merged|already processed/i);
    expect(String(rejected[0]?.reason)).not.toMatch(/Conflicting field/);

    // The CR ends up in a clean terminal state — merged, not stuck in "conflict"
    // with an empty payload (the corruption this regression test guards against).
    const finalCr = await client.changeRequests.get({ changeRequestId: cr.id });
    expect(finalCr?.status).toBe("merged");
    expect(finalCr?.mergeSummary).toBeTruthy();
  });
});
