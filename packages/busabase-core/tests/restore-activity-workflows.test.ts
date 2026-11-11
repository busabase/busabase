import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { getLocalStoragePath, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import {
  assertRestoreActivity,
  beginRestoreActivity,
  endRestoreActivity,
  isRestoreAutomationBlocked,
  restoreActivityKey,
} from "../src/domains/dump/logic/restore-activity";
import { cleanupAbandonedRestoreBlobs } from "../src/domains/dump/logic/restore-blob-receipts";
import {
  cancelQueuedStoredWorkflowRuns,
  cancelStoredWorkflowRun,
  decideStoredWorkflowRun,
  processDueWorkflowRuns,
  resumeElapsedStoredWorkflowRuns,
  resumeStoredWorkflowRun,
  retryStoredWorkflowRun,
  startStoredWorkflowRun,
} from "../src/domains/workflow/logic/run-service";
import { createDbWorkflowRunStore } from "../src/domains/workflow/logic/run-store-db";
import {
  enqueueDueScheduledRuns,
  enqueueWorkflowHookRun,
  enqueueWorkflowRunsForRecordEvent,
} from "../src/domains/workflow/logic/triggers";
import { busabaseWorkflowRuns } from "../src/domains/workflow/schema/workflow-runs";
import { busabaseWorkflowTriggers } from "../src/domains/workflow/schema/workflow-triggers";
import { ensureReady } from "../src/logic/seed";

const execute = promisify(execFile);
let dataDir = "",
  storageDir = "",
  originalCwd = "";
beforeAll(async () => {
  originalCwd = process.cwd();
  process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
  dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-restore-hold-db-"));
  storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-restore-hold-storage-"));
  process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/storage`;
  await ensureReady();
}, 120_000);
afterAll(async () => {
  process.chdir(originalCwd);
  delete process.env.PG_DATABASE_URL;
  delete process.env.STORAGE_URL;
  await rm(dataDir, { recursive: true, force: true });
  await rm(storageDir, { recursive: true, force: true });
});

const marker = (spaceId: string, sessionId = "dumpsess_original") => ({
  spaceId,
  sessionId,
  sourceSpaceId: "original-source",
  resume: false,
});
const runRow = (
  spaceId: string,
  id: string,
  status: "queued" | "waiting" | "running" | "completed",
  at = new Date(),
) => ({
  id,
  spaceId,
  workflowNodeId: `workflow-${spaceId}`,
  status,
  trigger: "event" as const,
  startedBy: "actor",
  startedVia: null,
  cancelledBy: null,
  cursorNodeId: "trigger",
  previousNodeId: null,
  recordId: null,
  payload: {},
  outputs: {},
  pause:
    status === "waiting"
      ? { kind: "wait", nodeId: "wait", resumeAt: new Date(Date.now() - 10_000).toISOString() }
      : null,
  resumeAt: status === "waiting" ? new Date(Date.now() - 10_000) : null,
  leaseUntil: null,
  error: null,
  startedAt: at,
  updatedAt: at,
});

describe("durable space restore activity with real DB and storage", () => {
  it("survives another process and remains held until the owning successful session ends", async () => {
    const db = await getDb();
    const input = marker("restore-durable");
    await beginRestoreActivity(db, input);
    expect(await isRestoreAutomationBlocked(input.spaceId)).toBe(true);
    const source = `import {isRestoreAutomationBlocked} from ${JSON.stringify(new URL("../src/domains/dump/logic/restore-activity.ts", import.meta.url).href)};console.log(JSON.stringify({pid:process.pid,blocked:await isRestoreAutomationBlocked(${JSON.stringify(input.spaceId)})}));`;
    const child = await execute(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "-e",
        source,
      ],
      { timeout: 20_000, env: { ...process.env } },
    );
    const result = JSON.parse(child.stdout.trim());
    expect(result.blocked).toBe(true);
    expect(result.pid).not.toBe(process.pid);
    await cleanupAbandonedRestoreBlobs(input.spaceId, new Set());
    expect(await isRestoreAutomationBlocked(input.spaceId)).toBe(true);
    await expect(beginRestoreActivity(db, marker(input.spaceId, "dumpsess_other"))).rejects.toThrow(
      "unfinished restore",
    );
    await expect(
      beginRestoreActivity(db, {
        ...marker(input.spaceId, "dumpsess_other"),
        resume: true,
        sourceSpaceId: "different",
      }),
    ).rejects.toThrow("unfinished restore");
    const staleTemporary = `${getLocalStoragePath(restoreActivityKey(input.spaceId))}.0123456789abcdef.tmp`;
    await writeFile(staleTemporary, "interrupted marker publication");
    await beginRestoreActivity(db, { ...marker(input.spaceId, "dumpsess_resumed"), resume: true });
    await expect(readFile(staleTemporary)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(assertRestoreActivity(input.spaceId, input.sessionId)).rejects.toThrow(
      "no longer owns",
    );
    await expect(endRestoreActivity(db, input)).rejects.toThrow("different restore");
    await assertRestoreActivity(input.spaceId, "dumpsess_resumed");
    await writeFile(staleTemporary, "another crash-left marker temporary");
    await endRestoreActivity(db, { spaceId: input.spaceId, sessionId: "dumpsess_resumed" });
    await expect(readFile(staleTemporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await isRestoreAutomationBlocked(input.spaceId)).toBe(false);
  });

  it("blocks reads of malformed or unreadable marker objects without treating errors as absence", async () => {
    const malformed = restoreActivityKey("restore-malformed");
    await storage.uploadFileToKey(Buffer.from("not valid JSON"), malformed, "application/json");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isRestoreAutomationBlocked("restore-malformed")).toBe(true);
    const directory = getLocalStoragePath(restoreActivityKey("restore-unreadable"));
    await mkdir(directory, { recursive: true });
    expect(await isRestoreAutomationBlocked("restore-unreadable")).toBe(true);
    expect(await isRestoreAutomationBlocked("restore-clear")).toBe(false);
    quiet.mockRestore();
  });

  it("does not advance, fail or purge protected run rows and does not starve another space at LIMIT 1", async () => {
    const db = await getDb(),
      held = "restore-run-guard",
      healthy = "restore-run-healthy";
    const old = new Date(Date.now() - 100 * 86_400_000);
    await beginRestoreActivity(db, marker(held));
    await db
      .insert(busabaseWorkflowRuns)
      .values([
        runRow(held, "held-queued", "queued", old),
        runRow(held, "held-waiting", "waiting", old),
        runRow(held, "held-running", "running", old),
        runRow(held, "held-finished", "completed", old),
        runRow(healthy, "healthy-queued", "queued"),
        runRow(healthy, "healthy-finished", "completed", old),
      ]);
    const before = await db
      .select()
      .from(busabaseWorkflowRuns)
      .where(eq(busabaseWorkflowRuns.spaceId, held));
    const store = createDbWorkflowRunStore(() => db);
    expect((await store.listDue(Date.now(), 1)).map((row) => row.id)).toEqual(["healthy-queued"]);
    expect((await store.listInterrupted(Date.now(), 1)).some((row) => row.spaceId === held)).toBe(
      false,
    );
    const actors: string[] = [];
    const result = await processDueWorkflowRuns({
      db,
      limit: 1,
      runAs: async (actor) => {
        actors.push(actor.spaceId);
        throw new Error("Test host intentionally has no actor connection");
      },
    });
    expect(actors).toEqual([healthy]);
    expect(result.orphaned).toBe(1);
    expect(
      await db.select().from(busabaseWorkflowRuns).where(eq(busabaseWorkflowRuns.spaceId, held)),
    ).toEqual(before);
    expect(
      await db
        .select()
        .from(busabaseWorkflowRuns)
        .where(eq(busabaseWorkflowRuns.id, "healthy-finished")),
    ).toEqual([]);
    await endRestoreActivity(db, marker(held));
    expect((await store.listDue(Date.now(), 1))[0].spaceId).toBe(held);
  });

  it("rejects explicit workflow mutations while restoring without changing stored status", async () => {
    const db = await getDb(),
      spaceId = "restore-explicit-mutations";
    const input = marker(spaceId);
    await beginRestoreActivity(db, input);
    await db.insert(busabaseWorkflowRuns).values(runRow(spaceId, "explicit-held-run", "queued"));
    const before = await db
      .select()
      .from(busabaseWorkflowRuns)
      .where(eq(busabaseWorkflowRuns.spaceId, spaceId));
    const actions = [
      () => startStoredWorkflowRun({ nodeId: "workflow" }),
      () => resumeStoredWorkflowRun({ runId: "explicit-held-run" }),
      () => decideStoredWorkflowRun({ runId: "explicit-held-run", decision: "approved" }),
      () => retryStoredWorkflowRun({ runId: "explicit-held-run" }),
      () => cancelStoredWorkflowRun({ runId: "explicit-held-run" }),
      () => cancelQueuedStoredWorkflowRuns({ nodeId: "workflow" }),
      () => resumeElapsedStoredWorkflowRuns(),
    ];
    for (const action of actions)
      await expect(runWithBusabaseContext({ spaceId }, action)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("space is being restored"),
      });
    expect(
      await db.select().from(busabaseWorkflowRuns).where(eq(busabaseWorkflowRuns.spaceId, spaceId)),
    ).toEqual(before);
    await endRestoreActivity(db, input);
    await expect(
      runWithBusabaseContext({ spaceId }, () =>
        startStoredWorkflowRun({ nodeId: "workflow-not-found" }),
      ),
    ).rejects.not.toMatchObject({ code: "CONFLICT" });
  });

  it("holds scheduled, record-event and webhook triggering without modifying original trigger timestamps", async () => {
    const db = await getDb(),
      spaceId = "restore-trigger-guard",
      workflowNodeId = `workflow-${spaceId}`,
      now = new Date();
    await db.insert(busabaseNodes).values({
      id: workflowNodeId,
      spaceId,
      parentId: null,
      type: "workflow",
      slug: workflowNodeId,
      name: "Restored workflow",
    });
    await db.insert(busabaseWorkflowTriggers).values([
      {
        id: "held-schedule",
        spaceId,
        workflowNodeId,
        triggerNodeId: "schedule-step",
        eventType: "schedule",
        baseId: null,
        config: {
          schedule: { unit: "minutes", every: 15, at: "09:00", weekday: 1, timezone: "UTC" },
        },
        nextRunAt: new Date(now.getTime() - 60_000),
        armedBy: "actor",
        createdAt: now,
      },
      {
        id: "held-record",
        spaceId,
        workflowNodeId,
        triggerNodeId: "record-step",
        eventType: "record.created",
        baseId: null,
        config: null,
        nextRunAt: null,
        armedBy: "actor",
        createdAt: now,
      },
      {
        id: "held-hook",
        spaceId,
        workflowNodeId,
        triggerNodeId: "hook-step",
        eventType: "webhook",
        baseId: null,
        config: { hookToken: "example-incoming-hook-token" },
        nextRunAt: null,
        armedBy: "actor",
        createdAt: now,
      },
    ]);
    const input = marker(spaceId);
    await beginRestoreActivity(db, input);
    const before = await db
      .select()
      .from(busabaseWorkflowTriggers)
      .where(eq(busabaseWorkflowTriggers.spaceId, spaceId));
    expect(await enqueueDueScheduledRuns(db, now)).toBe(0);
    expect(
      await enqueueWorkflowRunsForRecordEvent(db, {
        spaceId,
        baseId: null,
        eventType: "record.created",
        recordIds: ["record"],
        changeRequestId: "change",
      }),
    ).toBe(0);
    const hookArgs = {
      workflowNodeId,
      token: "example-incoming-hook-token",
      request: {
        method: "POST",
        query: {},
        headers: {},
        body: null,
        receivedAt: now.toISOString(),
      },
      now,
    };
    expect(await enqueueWorkflowHookRun(db, hookArgs)).toEqual({ kind: "busy" });
    expect(
      await db.select().from(busabaseWorkflowRuns).where(eq(busabaseWorkflowRuns.spaceId, spaceId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(busabaseWorkflowTriggers)
        .where(eq(busabaseWorkflowTriggers.spaceId, spaceId)),
    ).toEqual(before);
    await endRestoreActivity(db, input);
    expect(await enqueueDueScheduledRuns(db, now)).toBe(1);
    expect(
      await enqueueWorkflowRunsForRecordEvent(db, {
        spaceId,
        baseId: null,
        eventType: "record.created",
        recordIds: ["record"],
        changeRequestId: "change",
      }),
    ).toBe(1);
    expect(await enqueueWorkflowHookRun(db, hookArgs)).toMatchObject({ kind: "queued", spaceId });
    expect(
      (
        await db
          .select()
          .from(busabaseWorkflowRuns)
          .where(eq(busabaseWorkflowRuns.spaceId, spaceId))
      ).length,
    ).toBe(3);
  });
});
