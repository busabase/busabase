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
    const bases = await client.bases.list({});
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

  const createRecord = async () => {
    const cr = await client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title: "orig title", body: "orig body", channel: "blog" },
      message: "Create",
      submittedBy: "agent",
      autoMerge: false,
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
    client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { title: "orig title", body: "orig body", channel: "blog", ...overrides },
      autoMerge: false,
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

    expect(merged.record?.headCommit.payload.title).toBe("new title from C");
    expect(merged.record?.headCommit.payload.body).toBe("new body from A");
  });

  it("blocks the merge when the same field changed on both sides", async () => {
    const recordId = await createRecord();
    const titleCrC = await proposeUpdate(recordId, { title: "title from C" });
    const titleCrD = await proposeUpdate(recordId, { title: "title from D" });

    await approveAndMerge(titleCrC.id);
    // D also changed `title`, from the same base → genuine conflict.
    await client.changeRequests.review({
      changeRequestIds: [titleCrD.id],
      verdict: "approved",
    });
    const mergeResult = await client.changeRequests.merge({ changeRequestIds: [titleCrD.id] });
    expect(mergeResult.results[0]).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Conflicting field.*title/),
    });
  });

  it("ignores a required field deleted after a record change request was created", async () => {
    const base = await client.bases.create({
      slug: "deleted-required-field",
      name: "Deleted Required Field",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    const recordCr = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "Created before the schema changed" },
      autoMerge: false,
    });

    const addHeroCr = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: base.id,
      slug: "hero",
      name: "Hero",
      type: "json",
      required: true,
    });
    await approveAndMerge(addHeroCr.id);
    const currentBase = (await client.bases.list({})).find((item) => item.id === base.id);
    const heroFieldId = currentBase?.fields.find((field) => field.slug === "hero")?.id;
    if (!heroFieldId) {
      throw new Error("expected the required hero field to exist before deletion");
    }

    const deleteHeroCr = await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: heroFieldId,
    });
    await approveAndMerge(deleteHeroCr.id);

    const merged = await approveAndMerge(recordCr.id);
    expect(merged.record?.headCommit.payload).toEqual({
      title: "Created before the schema changed",
    });
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
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });

    const results = await Promise.allSettled([
      client.changeRequests.merge({ changeRequestIds: [cr.id] }),
      client.changeRequests.merge({ changeRequestIds: [cr.id] }),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const items = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value.results : [],
    );
    expect(items.filter((item) => item.ok)).toHaveLength(1);
    expect(items.find((item) => item.ok && item.record)?.record).toBeTruthy();
    const failed = items.find((item) => !item.ok);
    expect(failed?.ok).toBe(false);
    if (failed?.ok === false) {
      expect(failed.error).toMatch(/already being merged|already processed/i);
      expect(failed.error).not.toMatch(/Conflicting field/);
    }

    // The CR ends up in a clean terminal state — merged, not stuck in "conflict"
    // with an empty payload (the corruption this regression test guards against).
    const finalCr = await client.changeRequests.get({ changeRequestId: cr.id });
    expect(finalCr?.status).toBe("merged");
    expect(finalCr?.mergeSummary).toBeTruthy();
  });
});
