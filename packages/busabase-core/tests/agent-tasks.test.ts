import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * The agent work-queue (`/agent/tasks`): the poll surface an external agent uses
 * to find change requests awaiting revision — a CR is queued when a reviewer
 * requested changes, or when it carries an `@ai` mention. A plain in_review CR
 * with no agent signal must NOT be queued.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Agent task queue — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-storage-"));
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

  const openCr = (title: string) =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title, body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "loop-agent",
      autoMerge: false,
    });

  it("queues request-changes and @ai-mentioned CRs, and skips quiet ones", async () => {
    const requested = await openCr("Needs changes");
    await client.changeRequests.review({
      changeRequestId: requested.id,
      verdict: "rejected",
      reason: "Tighten the intro. @ai",
    });

    const mentioned = await openCr("Has an @ai mention");
    await client.comments.create({
      subjectType: "change_request",
      subjectId: mentioned.id,
      body: "@ai please add a source link",
      mentionsAi: true,
    });

    const quiet = await openCr("Just awaiting review");

    const tasks = await client.agent.listTasks();
    const byId = new Map(tasks.map((task) => [task.changeRequest.id, task]));

    const requestedTask = byId.get(requested.id);
    expect(requestedTask?.trigger).toBe("changes_requested");
    expect(requestedTask?.reviewReason).toContain("Tighten");

    const mentionedTask = byId.get(mentioned.id);
    expect(mentionedTask?.trigger).toBe("ai_mention");
    expect(mentionedTask?.aiComments.some((comment) => comment.body.includes("source link"))).toBe(
      true,
    );

    // A plain in_review CR with no agent signal is not the agent's job.
    expect(byId.has(quiet.id)).toBe(false);
  });

  it("drops a CR from the queue once the agent revises it", async () => {
    const cr = await openCr("Revise me");
    const operationId = cr.primaryOperation?.id ?? "";
    await client.changeRequests.review({
      changeRequestId: cr.id,
      verdict: "rejected",
      reason: "Fix it",
    });
    expect((await client.agent.listTasks()).some((task) => task.changeRequest.id === cr.id)).toBe(
      true,
    );

    // Revising returns the CR to in_review; with no @ai mention it leaves the queue.
    await client.operations.revise({
      operationId,
      fields: { title: "Revise me", body: "v2", channel: "blog" },
    });
    expect((await client.agent.listTasks()).some((task) => task.changeRequest.id === cr.id)).toBe(
      false,
    );
  });
});
