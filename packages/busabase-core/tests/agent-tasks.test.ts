import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { LIST_OMITTED_LONG_TEXT_VALUE } from "../src/domains/dashboard/utils/list-payload-preview";
import { AGENT_TASK_MAX_OPERATIONS } from "../src/logic/cr-lifecycle";
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

  const openCr = (title: string) =>
    client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title, body: "v1", channel: "blog" },
      message: "Initial",
      submittedBy: "loop-agent",
      autoMerge: false,
    });

  it("queues request-changes and agent-mentioned CRs, and skips quiet ones", async () => {
    const requested = await openCr("Needs changes");
    await client.changeRequests.review({
      changeRequestIds: [requested.id],
      verdict: "rejected",
      reason: "Tighten the intro. @ai",
    });

    const mentioned = await openCr("Has an agent mention");
    await client.comments.create({
      subjectType: "change_request",
      subjectId: mentioned.id,
      // A slug deliberately absent from the catalog: `resolveLaunch` refuses it,
      // so dispatch fails fast instead of npx-spawning a real agent in a test —
      // and the queue must list the CR anyway, because the ASK happened.
      body: "@Codex please add a source link",
      mentions: [{ type: "agent", id: "test-missing-agent", start: 0, end: 6 }],
    });

    // A comment that only mentions PEOPLE must never enter the agent queue —
    // that is the difference the boolean could not express.
    const memberOnly = await openCr("Only a teammate was tagged");
    await client.comments.create({
      subjectType: "change_request",
      subjectId: memberOnly.id,
      body: "@Alice can you look?",
      mentions: [{ type: "member", id: "local-editor", start: 0, end: 6 }],
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
    // The queue can finally say WHICH agent was asked, not just that one was.
    expect(
      mentionedTask?.aiComments.flatMap((comment) =>
        comment.mentions.filter((m) => m.type === "agent").map((m) => m.targetId),
      ),
    ).toEqual(["test-missing-agent"]);

    // A dispatch that could not start still leaves a visible, named reason.
    const failedMention = mentionedTask?.aiComments
      .flatMap((comment) => comment.mentions)
      .find((m) => m.type === "agent");
    expect(failedMention?.dispatchStatus).toBe("failed");
    expect(failedMention?.error).toBeTruthy();

    expect(byId.has(memberOnly.id)).toBe(false);

    // A plain in_review CR with no agent signal is not the agent's job.
    expect(byId.has(quiet.id)).toBe(false);
  });

  const requestChanges = (changeRequestId: string, reason = "Fix it") =>
    client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "rejected",
      reason,
    });

  it("embeds a list-sized preview and says where the full change request is", async () => {
    // 3.5 MB for eight tasks in production was long text, carried in full twice
    // per operation. A poll now carries the marker; the detail keeps the text.
    const longBody = "Long draft paragraph. ".repeat(600);
    const cr = await client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields: { title: "Long draft", body: longBody, channel: "blog" },
      message: "Initial",
      submittedBy: "loop-agent",
      autoMerge: false,
    });
    await requestChanges(cr.id, "Shorter, please");

    const task = (await client.agent.listTasks()).find((item) => item.changeRequest.id === cr.id);
    expect(task).toBeDefined();
    expect(task?.id).toBe(cr.id);
    expect(task?.truncated).toBe(true);
    expect(task?.omittedOperationCount).toBe(0);
    expect(task?.changeRequestPath).toBe(`/api/v1/change-requests/${cr.id}`);
    expect(task?.reviewReason).toBe("Shorter, please");
    const preview = task?.changeRequest.operations[0]?.headCommit.payload ?? {};
    expect(preview.body).toBe(LIST_OMITTED_LONG_TEXT_VALUE);
    // Short values are untouched: the preview still says what is being changed.
    expect(preview.title).toBe("Long draft");
    expect(task?.changeRequest.primaryOperation?.headCommit.payload.body).toBe(
      LIST_OMITTED_LONG_TEXT_VALUE,
    );

    const detail = await client.changeRequests.get({ changeRequestId: cr.id });
    expect(detail.operations[0]?.headCommit.payload.body).toBe(longBody);

    // An agent that edits the preview and sends it back must not overwrite the
    // real text with the marker.
    const operationId = detail.operations[0]?.id ?? "";
    await expect(
      client.operations.revise({
        operationId,
        fields: { title: "Long draft", body: LIST_OMITTED_LONG_TEXT_VALUE, channel: "blog" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await client.changeRequests.get({ changeRequestId: cr.id })).status).toBe(
      "changes_requested",
    );
    await client.operations.revise({
      operationId,
      fields: { title: "Long draft", body: "Short now.", channel: "blog" },
    });
    expect((await client.agent.listTasks()).some((item) => item.changeRequest.id === cr.id)).toBe(
      false,
    );
  });

  it("caps a bulk change request's operations and reports how many were left out", async () => {
    const total = AGENT_TASK_MAX_OPERATIONS + 5;
    const bulk = await client.bases.createBulkChangeRequest({
      baseId: blogBaseId,
      records: Array.from({ length: total }, (_, index) => ({
        title: `Bulk ${index}`,
        body: "short",
        channel: "blog",
      })),
      autoMerge: false,
    });
    await requestChanges(bulk.id);

    const task = (await client.agent.listTasks()).find((item) => item.changeRequest.id === bulk.id);
    expect(task?.changeRequest.operationCount).toBe(total);
    expect(task?.changeRequest.operations).toHaveLength(AGENT_TASK_MAX_OPERATIONS);
    expect(task?.omittedOperationCount).toBe(5);
    expect(task?.truncated).toBe(true);
    expect((await client.changeRequests.get({ changeRequestId: bulk.id })).operations).toHaveLength(
      total,
    );
  });

  it("pages oldest first with limit + cursor, and refuses an unknown cursor", async () => {
    for (const title of ["Page one", "Page two", "Page three"]) {
      await requestChanges((await openCr(title)).id);
    }
    const all = await client.agent.listTasks();
    expect(all.length).toBeGreaterThanOrEqual(3);
    const createdAt = all.map((task) => task.changeRequest.createdAt);
    expect([...createdAt].sort()).toEqual(createdAt);

    const paged: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await client.agent.listTasks({ limit: 2, cursor });
      expect(page.length).toBeLessThanOrEqual(2);
      paged.push(...page.map((task) => task.changeRequest.id));
      if (page.length < 2) break;
      cursor = page[page.length - 1]?.id;
    }
    expect(paged).toEqual(all.map((task) => task.changeRequest.id));

    await expect(
      client.agent.listTasks({ limit: 2, cursor: "cr_does_not_exist" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("serves the same queue over REST, with and without the new query parameters", async () => {
    // An older CLI or SDK sends no parameters; a newer one sends `limit`/`cursor`
    // as query strings, which have to coerce.
    const handler = new OpenAPIHandler(busabaseRouter);
    const get = async (query: string) => {
      const result = await handler.handle(
        new Request(`http://localhost/api/v1/agent/tasks${query}`, { method: "GET" }),
        { context: {} },
      );
      if (!result.matched) throw new Error("no route matched /agent/tasks");
      return { status: result.response.status, body: await result.response.json() };
    };
    const legacy = await get("");
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacy.body)).toBe(true);
    expect(legacy.body.length).toBeGreaterThanOrEqual(2);
    const first = await get("?limit=1");
    expect(first.status).toBe(200);
    expect(first.body).toHaveLength(1);
    expect(first.body[0].id).toBe(legacy.body[0].changeRequest.id);
    const second = await get(`?limit=1&cursor=${encodeURIComponent(first.body[0].id)}`);
    expect(second.body[0].changeRequest.id).toBe(legacy.body[1].changeRequest.id);
    expect((await get("?limit=0")).status).toBe(400);
  });

  it("never lists a task on a Base the caller cannot see", async () => {
    const hidden = await client.bases.create({
      slug: "agent-hidden",
      name: "Agent hidden",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    if (!hidden.materialized || !hidden.nodeId) throw new Error("Expected a materialized Base");
    const secret = await client.bases.createChangeRequest({
      baseId: hidden.id,
      fields: { title: "Secret plan" },
      autoMerge: false,
    });
    await requestChanges(secret.id);
    const visible = await openCr("Visible to members");
    await requestChanges(visible.id);
    await client.nodes.updateVisibility({ nodeId: hidden.nodeId, visibility: "private" });

    const asMember = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "agent-tasks-member",
        isSpaceManager: false,
        permissionLevel: "write",
      },
      () => client.agent.listTasks(),
    );
    const memberIds = asMember.map((task) => task.changeRequest.id);
    expect(memberIds).toContain(visible.id);
    expect(memberIds).not.toContain(secret.id);
    expect((await client.agent.listTasks()).map((task) => task.changeRequest.id)).toContain(
      secret.id,
    );
  });

  it("drops a CR from the queue once the agent revises it", async () => {
    const cr = await openCr("Revise me");
    const operationId = cr.primaryOperation?.id ?? "";
    await client.changeRequests.review({
      changeRequestIds: [cr.id],
      verdict: "rejected",
      reason: "Fix it",
    });
    expect((await client.agent.listTasks()).some((task) => task.changeRequest.id === cr.id)).toBe(
      true,
    );

    // Revising returns the CR to in_review; with no agent mention it leaves the queue.
    await client.operations.revise({
      operationId,
      fields: { title: "Revise me", body: "v2", channel: "blog" },
    });
    expect((await client.agent.listTasks()).some((task) => task.changeRequest.id === cr.id)).toBe(
      false,
    );
  });
});
