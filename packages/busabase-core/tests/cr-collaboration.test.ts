import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Kernel change-request collaboration: the revise / close / review-history /
 * comment / audit paths that surround the merge engine. These mutate the
 * change-request, operation, commit, review, comment, and audit tables, so they
 * are core to the database staying consistent through a full review loop.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Change-request collaboration — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-collab-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-collab-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
    expect(blogBaseId).not.toBe("");
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

  const createCr = (fields: Record<string, unknown>) =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields,
      message: "Create",
      submittedBy: "agent",
    });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  // ── revise (request-changes → revise → approve) ───────────────────────────
  describe("operations.revise", () => {
    it("returns a rejected change request to review and merges the revised fields", async () => {
      const cr = await createCr({ title: "draft", body: "rough", channel: "blog" });
      const operationId = cr.primaryOperation?.id ?? "";
      expect(operationId).not.toBe("");

      // Reviewer requests changes (a non-terminal "rejected" verdict).
      const reviewed = await client.changeRequests.review({
        changeRequestId: cr.id,
        verdict: "rejected",
        reason: "needs polish",
      });
      expect(reviewed.status).toBe("changes_requested");

      // Agent revises → the CR returns to in_review with the new field values.
      const revised = await client.operations.revise({
        operationId,
        fields: { title: "polished", body: "clean", channel: "blog" },
      });
      expect(revised.status).toBe("in_review");
      expect(revised.primaryOperation?.headCommit.fields.title).toBe("polished");

      const merged = await approveAndMerge(cr.id);
      expect(merged.record?.headCommit.fields.title).toBe("polished");
    });

    it("rejects revising an unknown operation", async () => {
      await expect(
        client.operations.revise({
          operationId: "qop_missing",
          fields: { title: "x" },
        }),
      ).rejects.toThrow(/Operation not found/);
    });

    it("rejects revising an already-merged change request", async () => {
      const cr = await createCr({ title: "final", body: "b", channel: "blog" });
      const operationId = cr.primaryOperation?.id ?? "";
      await approveAndMerge(cr.id);

      await expect(
        client.operations.revise({
          operationId,
          fields: { title: "too late" },
        }),
      ).rejects.toThrow(/not revisable/);
    });
  });

  // ── close (terminal reject) ───────────────────────────────────────────────
  describe("changeRequests.close", () => {
    it("terminally closes an in-review change request with a reason", async () => {
      const cr = await createCr({ title: "to close", body: "b", channel: "blog" });
      const closed = await client.changeRequests.close({
        changeRequestId: cr.id,
        reason: "Out of scope",
      });
      expect(closed.status).toBe("rejected");
      expect(closed.rejectedReason).toBe("Out of scope");
    });

    it("refuses to close an already-closed change request", async () => {
      const cr = await createCr({ title: "close twice", body: "b", channel: "blog" });
      await client.changeRequests.close({ changeRequestId: cr.id });
      await expect(client.changeRequests.close({ changeRequestId: cr.id })).rejects.toThrow(
        /not closable/,
      );
    });
  });

  // ── record change-request history ─────────────────────────────────────────
  it("lists a record's change-request history", async () => {
    const cr = await createCr({ title: "history", body: "b", channel: "blog" });
    const merged = await approveAndMerge(cr.id);
    const recordId = merged.record?.id ?? "";

    const updateCr = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "history v2", body: "b", channel: "blog" },
    });

    const history = await client.records.listChangeRequests({ recordId });
    expect(history.map((h) => h.id)).toContain(updateCr.id);
  });

  // ── comments ──────────────────────────────────────────────────────────────
  it("creates and lists comments on a change request, flagging AI mentions", async () => {
    const cr = await createCr({ title: "commented", body: "b", channel: "blog" });

    const created = await client.comments.create({
      subjectType: "change_request",
      subjectId: cr.id,
      body: "Please review @ai",
      mentionsAi: true,
    });
    expect(created.body).toBe("Please review @ai");

    const listed = await client.comments.list({
      subjectType: "change_request",
      subjectId: cr.id,
    });
    expect(listed.map((c) => c.id)).toContain(created.id);
    expect(listed.find((c) => c.id === created.id)?.mentionsAi).toBe(true);
  });

  // ── audit events ──────────────────────────────────────────────────────────
  it("records and lists audit events", async () => {
    const created = await client.auditEvents.create({
      action: "record.viewed",
      actorId: "tester",
      baseId: blogBaseId,
    });

    const listed = await client.auditEvents.list({ limit: 50 });
    expect(listed.map((e) => e.id)).toContain(created.id);
    // The seeded review loops also log events, so the feed is never empty.
    expect(listed.length).toBeGreaterThan(0);
  });
});
