import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  parseWorkflowDocument,
  type WorkflowDocument,
} from "busabase-contract/domains/rich-node/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The closed loop on a real router, real PGlite, and a real HTTP receiver:
 * a record event queues a run, the scheduler starts it as the person who
 * armed the workflow, a webhook step really sends, a Wait is persisted and
 * later resumed by the scheduler, and a redirect into a private address is
 * refused.
 */
describe("workflow runtime loop: events, scheduler, webhooks, persistence", () => {
  let dataDir = "";
  let storageDir = "";
  let server: Server;
  let origin = "";
  const received: Array<{ method: string; url: string; body: unknown }> = [];

  const readJson = async (request: IncomingMessage): Promise<unknown> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? (JSON.parse(text) as unknown) : null;
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-workflow-loop-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-workflow-loop-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;

    server = createServer((request, response) => {
      void (async () => {
        const body = await readJson(request);
        received.push({ method: request.method ?? "", url: request.url ?? "", body });
        if (request.url === "/redirect-to-metadata") {
          response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          response.end();
          return;
        }
        if (request.url === "/large-profile") {
          // An enrichment API answer: valid JSON, well past the 4,000-character text cap.
          response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              tier: "gold",
              history: Array.from({ length: 200 }, (_, i) => `event ${i} `.repeat(5)),
            }),
          );
          return;
        }
        if (request.url === "/broken") {
          response.writeHead(500, { "content-type": "text/plain" });
          response.end("receiver exploded");
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, tier: "gold" }));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
    // The SSRF guard refuses loopback; this one test receiver is allowed (VITEST only).
    process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = `127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };
  type Client = Awaited<ReturnType<typeof routerClient>>;

  /** One scheduler tick, exactly as the open-source host runs it. */
  const tick = async () => {
    const { runWithLocalContext } = await import("busabase-core/context");
    const { getDb } = await import("busabase-core/db");
    const { processDueWorkflowRuns } = await import("busabase-core/domains/workflow/run-service");
    return processDueWorkflowRuns({
      db: await getDb(),
      runAs: (_actor, fn) => runWithLocalContext({}, fn),
    });
  };

  const storedRow = async (runId: string) => {
    const { getDb } = await import("busabase-core/db");
    const { busabaseWorkflowRuns } = await import("busabase-core/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const [row] = await db
      .select()
      .from(busabaseWorkflowRuns)
      .where(eq(busabaseWorkflowRuns.id, runId));
    return row;
  };

  const createBase = async (client: Client, slug: string) =>
    client.bases.create({
      slug,
      name: slug,
      fields: [{ slug: "status", name: "Status", type: "text", required: true, options: {} }],
      autoMerge: true,
    });

  const createRecord = async (client: Client, baseId: string, status: string) => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields: { status },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("Expected the record to merge");
    return created.id;
  };

  const saveWorkflow = async (
    client: Client,
    slug: string,
    document: WorkflowDocument,
    nodeId?: string,
  ) => {
    let id = nodeId;
    if (!id) {
      const created = await client.nodes.createChangeRequest({
        message: `Add ${slug}`,
        autoMerge: true,
        operations: [{ kind: "create", nodeType: "workflow", slug, name: slug, description: "" }],
      });
      id = created.operations[0]?.nodeId ?? undefined;
      if (!id) throw new Error("Expected a workflow node id");
    }
    await client.nodes.updateContent({
      nodeId: id,
      message: `Save ${slug}`,
      autoMerge: true,
      content: { kind: "workflow", document },
    });
    return id;
  };

  const leadFlow = (baseId: string, url: string, executionMode: "event" | "manual") =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        {
          id: "on-create",
          kind: "trigger",
          label: "New lead",
          position: { x: 0, y: 0 },
          eventName: "record.created",
          baseId,
        },
        { id: "enrich", kind: "webhook", label: "Enrich", position: { x: 1, y: 0 }, url },
        {
          id: "gold",
          kind: "condition",
          label: "Gold?",
          position: { x: 2, y: 0 },
          expression: 'input.status == 200 && input.body.tier == "gold"',
        },
        {
          id: "cool-off",
          kind: "wait",
          label: "Cool off",
          position: { x: 3, y: 0 },
          duration: 0,
          unit: "minutes",
        },
        {
          id: "reload",
          kind: "action",
          label: "Reload",
          position: { x: 4, y: 0 },
          actionName: "read_record",
        },
        { id: "done", kind: "end", label: "Done", position: { x: 5, y: 0 }, outcome: "gold" },
        { id: "skip", kind: "end", label: "Skip", position: { x: 3, y: 1 }, outcome: "not-gold" },
      ],
      edges: [
        { id: "e1", source: "on-create", target: "enrich", outcome: "default" },
        { id: "e2", source: "enrich", target: "gold", outcome: "success" },
        { id: "e3", source: "gold", target: "cool-off", outcome: "true" },
        { id: "e4", source: "gold", target: "skip", outcome: "false" },
        { id: "e5", source: "cool-off", target: "reload", outcome: "elapsed" },
        { id: "e6", source: "reload", target: "done", outcome: "success" },
      ],
      settings: { executionMode },
    });

  it("queues a run on record.created, then the scheduler sends the webhook, waits, and finishes", async () => {
    const client = await routerClient();
    const leads = await createBase(client, "loop-leads");
    const other = await createBase(client, "loop-other");
    const workflowId = await saveWorkflow(
      client,
      "loop-lead-flow",
      leadFlow(leads.id, `${origin}/enrich`, "event"),
    );

    // A record in another Base does not match the trigger's Base filter.
    await createRecord(client, other.id, "new");
    expect((await client.workflows.list({ nodeId: workflowId })).runs).toEqual([]);

    const recordId = await createRecord(client, leads.id, "new");
    const queued = (await client.workflows.list({ nodeId: workflowId })).runs;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      status: "queued",
      trigger: "event",
      // The person who saved the workflow in event mode (the open-source
      // placeholder author here; the signed-in member in the cloud).
      startedBy: "local-producer",
      recordId,
      payload: { event: "record.created", recordId, baseId: leads.id },
    });
    expect(received).toEqual([]);

    // Tick 1 starts it: the webhook really goes out, then the Wait pauses it.
    const first = await tick();
    expect(first.continued).toBe(1);
    const queuedRunId = queued[0]?.id;
    if (!queuedRunId) throw new Error("Expected a queued run");
    const paused = await client.workflows.get({ runId: queuedRunId });
    expect(paused.status).toBe("waiting");
    expect(paused.outputs["on-create"]?.record?.fields.status).toBe("new");
    expect(paused.outputs.enrich?.data).toMatchObject({
      executed: true,
      status: 200,
      body: { ok: true, tier: "gold" },
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: "POST",
      url: "/enrich",
      body: {
        event: "workflow.step",
        runId: paused.id,
        stepId: "enrich",
        recordId,
        baseId: leads.id,
        fields: { status: "new" },
        payload: { event: "record.created", recordId },
      },
    });

    // The Wait lives in the database, not in this process.
    const row = await storedRow(paused.id);
    expect(row?.status).toBe("waiting");
    expect(row?.resumeAt).toBeInstanceOf(Date);
    expect(row?.leaseUntil).toBeNull();

    // Someone edits the record while the run waits.
    await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { status: "contacted" },
      autoMerge: true,
    });

    // Tick 2 resumes the elapsed Wait; read_record sees the edit, the trigger snapshot does not.
    const second = await tick();
    expect(second.continued).toBe(1);
    const finished = await client.workflows.get({ runId: paused.id });
    expect(finished.status).toBe("completed");
    expect(finished.outputs["on-create"]?.record?.fields.status).toBe("new");
    expect(finished.outputs.reload?.record?.fields.status).toBe("contacted");
    expect(finished.outputs.done?.data.outcome).toBe("gold");
    // Read back through jsonb (which reorders keys), the steps still say what ran first.
    expect(
      Object.entries(finished.outputs)
        .sort(([, a], [, b]) => (a.sequence ?? -1) - (b.sequence ?? -1))
        .map(([id]) => id),
    ).toEqual(["on-create", "enrich", "gold", "cool-off", "reload", "done"]);
    expect(Object.keys(finished.outputs)).not.toEqual([
      "on-create",
      "enrich",
      "gold",
      "cool-off",
      "reload",
      "done",
    ]);
    expect(received).toHaveLength(1);

    // Nothing left to do.
    expect((await tick()).continued).toBe(0);
  }, 120_000);

  it("stops queueing once the workflow is switched back to manual", async () => {
    const client = await routerClient();
    const base = await createBase(client, "loop-manual-leads");
    const workflowId = await saveWorkflow(
      client,
      "loop-manual-flow",
      leadFlow(base.id, `${origin}/enrich`, "event"),
    );
    await saveWorkflow(
      client,
      "loop-manual-flow",
      leadFlow(base.id, `${origin}/enrich`, "manual"),
      workflowId,
    );
    await createRecord(client, base.id, "new");
    expect((await client.workflows.list({ nodeId: workflowId })).runs).toEqual([]);
  }, 120_000);

  const singleHook = (url: string, errorPolicy: "stop" | "continue" = "stop") =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
        { id: "hook", kind: "webhook", label: "Hook", position: { x: 1, y: 0 }, url },
        { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "start", target: "hook" },
        { id: "e2", source: "hook", target: "end", outcome: "success" },
      ],
      settings: { errorPolicy },
    });

  it("keeps a large JSON answer as data the next condition can read", async () => {
    const client = await routerClient();
    const graph = parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
        {
          id: "hook",
          kind: "webhook",
          label: "Hook",
          position: { x: 1, y: 0 },
          url: `${origin}/large-profile`,
        },
        {
          id: "gold",
          kind: "condition",
          label: "Gold?",
          position: { x: 2, y: 0 },
          expression: 'input.body.tier == "gold"',
        },
        { id: "yes", kind: "end", label: "Yes", position: { x: 3, y: 0 }, outcome: "gold" },
        { id: "no", kind: "end", label: "No", position: { x: 3, y: 1 }, outcome: "other" },
      ],
      edges: [
        { id: "e1", source: "start", target: "hook" },
        { id: "e2", source: "hook", target: "gold", outcome: "success" },
        { id: "e3", source: "gold", target: "yes", outcome: "true" },
        { id: "e4", source: "gold", target: "no", outcome: "false" },
      ],
      settings: {},
    });
    const workflowId = await saveWorkflow(client, "loop-large-json", graph);
    const finished = await client.workflows.start({ nodeId: workflowId });
    expect(finished.status).toBe("completed");
    expect(finished.outputs.yes?.data.outcome).toBe("gold");
    const body = finished.outputs.hook?.data.body as { tier: string; history: string[] };
    expect(body.tier).toBe("gold");
    expect(body.history).toHaveLength(200);
  }, 120_000);

  it("queues a start over the workflow's concurrency and starts it once a slot frees", async () => {
    const client = await routerClient();
    const workflowId = await saveWorkflow(
      client,
      "loop-concurrency",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
          { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
        ],
        edges: [{ id: "e1", source: "start", target: "end" }],
        settings: { concurrency: 1 },
      }),
    );
    // Another run of this workflow is mid-step (for example a slow webhook).
    const { getDb } = await import("busabase-core/db");
    const { busabaseWorkflowRuns } = await import("busabase-core/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const now = new Date();
    await db.insert(busabaseWorkflowRuns).values({
      id: "wfr_loop_busy",
      spaceId: "local",
      workflowNodeId: workflowId,
      status: "running",
      trigger: "manual",
      startedBy: "local-admin",
      cursorNodeId: "end",
      previousNodeId: "start",
      recordId: null,
      payload: {},
      outputs: {},
      pause: null,
      resumeAt: null,
      error: null,
      leaseUntil: new Date(now.getTime() + 10 * 60_000),
      startedAt: now,
      updatedAt: now,
    });

    const queued = await client.workflows.start({ nodeId: workflowId });
    expect(queued.status).toBe("queued");
    expect((await tick()).continued).toBe(0);
    expect((await client.workflows.get({ runId: queued.id })).status).toBe("queued");

    await db
      .update(busabaseWorkflowRuns)
      .set({ status: "completed", leaseUntil: null })
      .where(eq(busabaseWorkflowRuns.id, "wfr_loop_busy"));
    expect((await tick()).continued).toBe(1);
    const finished = await client.workflows.get({ runId: queued.id });
    expect(finished.status).toBe("completed");
    expect(finished.trigger).toBe("manual");
  }, 120_000);

  it("pages, cancels, and purges runs in the real table", async () => {
    const client = await routerClient();
    const workflowId = await saveWorkflow(
      client,
      "loop-paging",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
          { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
        ],
        edges: [{ id: "e1", source: "start", target: "end" }],
        settings: {},
      }),
    );
    const { getDb } = await import("busabase-core/db");
    const { busabaseWorkflowRuns } = await import("busabase-core/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const row = (id: string, status: "queued" | "completed", minute: number) => {
      const at = new Date(Date.UTC(2026, 0, 1, 0, minute));
      return {
        id,
        spaceId: "local",
        workflowNodeId: workflowId,
        status,
        trigger: "event" as const,
        startedBy: "local-admin",
        cursorNodeId: "start",
        previousNodeId: null,
        recordId: null,
        payload: {},
        outputs: {},
        pause: null,
        resumeAt: null,
        error: null,
        leaseUntil: null,
        startedAt: at,
        updatedAt: new Date(),
      };
    };
    // Same millisecond on purpose: the cursor must not skip or repeat ties.
    await db
      .insert(busabaseWorkflowRuns)
      .values([
        row("wfr_page_a", "completed", 0),
        row("wfr_page_b", "completed", 0),
        row("wfr_page_c", "completed", 0),
        row("wfr_page_d", "completed", 1),
        row("wfr_page_e", "queued", 2),
        row("wfr_page_f", "queued", 3),
      ]);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.workflows.list({ nodeId: workflowId, limit: 2, cursor });
      seen.push(...page.runs.map((run) => run.id));
      expect(page.queuedCount).toBe(2);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([
      "wfr_page_f",
      "wfr_page_e",
      "wfr_page_d",
      "wfr_page_c",
      "wfr_page_b",
      "wfr_page_a",
    ]);

    expect(await client.workflows.cancelQueued({ nodeId: workflowId })).toEqual({ cancelled: 2 });
    const cancelled = await client.workflows.get({ runId: "wfr_page_e" });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBeTruthy();
    // Cancelled means cancelled: the scheduler does not pick these up.
    await tick();
    expect((await client.workflows.get({ runId: "wfr_page_f" })).status).toBe("cancelled");

    // Retention goes by when a run last changed: one just past 90 days, one just inside.
    await db
      .update(busabaseWorkflowRuns)
      .set({ updatedAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(busabaseWorkflowRuns.id, "wfr_page_a"));
    await db
      .update(busabaseWorkflowRuns)
      .set({ updatedAt: new Date(Date.now() - 89 * 86_400_000) })
      .where(eq(busabaseWorkflowRuns.id, "wfr_page_b"));
    await tick();
    const remaining = await db
      .select({ id: busabaseWorkflowRuns.id })
      .from(busabaseWorkflowRuns)
      .where(eq(busabaseWorkflowRuns.workflowNodeId, workflowId));
    const ids = remaining.map((item) => item.id);
    expect(ids).not.toContain("wfr_page_a");
    expect(ids).toContain("wfr_page_b");
  }, 120_000);

  it("lets a step change the record without starting itself again", async () => {
    const client = await routerClient();
    const base = await createBase(client, "loop-update");
    const recordId = await createRecord(client, base.id, "new");
    // The loop in waiting: it listens for updates and updates the record it was started for.
    const workflowId = await saveWorkflow(
      client,
      "loop-update-flow",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "on-update",
            kind: "trigger",
            label: "Lead changed",
            position: { x: 0, y: 0 },
            eventName: "record.updated",
            baseId: base.id,
          },
          {
            id: "qualify",
            kind: "action",
            label: "Qualify",
            position: { x: 1, y: 0 },
            actionName: "update_record",
            fields: { status: '=steps["on-update"].record.fields.status' },
          },
          {
            id: "reload",
            kind: "action",
            label: "Reload",
            position: { x: 2, y: 0 },
            actionName: "read_record",
          },
          { id: "end", kind: "end", label: "Done", position: { x: 3, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "on-update", target: "qualify" },
          { id: "e2", source: "qualify", target: "reload" },
          { id: "e3", source: "reload", target: "end" },
        ],
        settings: { executionMode: "event", concurrency: 5 },
      }),
    );

    // A person edits the lead: that is an ordinary edit and starts one run.
    await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { status: "contacted" },
      autoMerge: true,
    } as never);
    const first = await client.workflows.list({ nodeId: workflowId });
    expect(first.runs.map((run) => run.status)).toEqual(["queued"]);

    // The scheduler runs it. The step rewrites the record and merges, and that
    // merge must not queue another run.
    expect((await tick()).continued).toBe(1);
    const afterTick = await client.workflows.list({ nodeId: workflowId });
    expect(afterTick.runs).toHaveLength(1);
    const finished = afterTick.runs[0];
    expect(finished?.error).toBeNull();
    expect(finished?.status).toBe("completed");
    expect(finished?.outputs.qualify?.data).toMatchObject({
      executed: true,
      changed: { status: "contacted" },
    });
    expect(finished?.outputs.reload?.record?.fields.status).toBe("contacted");

    // And a second tick finds nothing left: no run was queued behind its back.
    expect((await tick()).continued).toBe(0);
    expect((await client.workflows.list({ nodeId: workflowId })).runs).toHaveLength(1);
  }, 120_000);

  it("changes a record by formula and keeps the old value in the earlier step's snapshot", async () => {
    const client = await routerClient();
    const base = await createBase(client, "update-formula");
    const recordId = await createRecord(client, base.id, "new");
    const workflowId = await saveWorkflow(
      client,
      "update-formula-flow",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
          {
            id: "set",
            kind: "action",
            label: "Set",
            position: { x: 1, y: 0 },
            actionName: "update_record",
            fields: { status: "=input.payload.next" },
          },
          { id: "end", kind: "end", label: "End", position: { x: 2, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "start", target: "set" },
          { id: "e2", source: "set", target: "end" },
        ],
        settings: {},
      }),
    );
    const run = await client.workflows.start({
      nodeId: workflowId,
      recordId,
      payload: { next: "won" },
    });
    expect(run.status).toBe("completed");
    expect(run.outputs.set?.record?.fields.status).toBe("won");
    expect(run.outputs.start?.record?.fields.status).toBe("new");
    expect((await client.records.get({ recordId })).headCommit.payload.status).toBe("won");
  }, 120_000);

  it("creates, updates another, and deletes records in the real tables, starting no workflows", async () => {
    const client = await routerClient();
    const leads = await createBase(client, "writes-leads");
    const tasks = await createBase(client, "writes-tasks");
    const lead = await createRecord(client, leads.id, "new");
    // Listens on the Base the step creates in, so a create that leaked an event would queue here.
    const watcher = await saveWorkflow(
      client,
      "writes-watcher",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "seen",
            kind: "trigger",
            label: "Task added",
            position: { x: 0, y: 0 },
            eventName: "record.created",
            baseId: tasks.id,
          },
          { id: "end", kind: "end", label: "End", position: { x: 1, y: 0 } },
        ],
        edges: [{ id: "e1", source: "seen", target: "end" }],
        settings: { executionMode: "event" },
      }),
    );
    const workflowId = await saveWorkflow(
      client,
      "writes-flow",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "start", kind: "trigger", label: "Start", position: { x: 0, y: 0 } },
          {
            id: "add",
            kind: "action",
            label: "Add task",
            position: { x: 1, y: 0 },
            actionName: "create_record",
            baseId: tasks.id,
            fields: { status: "=steps.start.record.fields.status" },
          },
          {
            id: "touch",
            kind: "action",
            label: "Touch task",
            position: { x: 2, y: 0 },
            actionName: "update_record",
            targetRecordId: "=steps.add.createdRecordId",
            fields: { status: "open" },
          },
          {
            id: "drop",
            kind: "action",
            label: "Drop lead",
            position: { x: 3, y: 0 },
            actionName: "delete_record",
          },
          { id: "end", kind: "end", label: "End", position: { x: 4, y: 0 } },
        ],
        edges: [
          { id: "e1", source: "start", target: "add" },
          { id: "e2", source: "add", target: "touch" },
          { id: "e3", source: "touch", target: "drop" },
          { id: "e4", source: "drop", target: "end" },
        ],
        settings: {},
      }),
    );

    const run = await client.workflows.start({ nodeId: workflowId, recordId: lead });
    expect(run.error).toBeNull();
    expect(run.status).toBe("completed");
    const created = String(run.outputs.add?.data.createdRecordId);
    expect((await client.records.get({ recordId: created })).headCommit.payload.status).toBe(
      "open",
    );
    // Moved to the trash, not gone: it lists there and can be restored.
    expect((await client.records.get({ recordId: lead })).status).toBe("archived");
    expect(run.outputs.drop?.data).toMatchObject({ deletedRecordId: lead });

    expect((await tick()).continued).toBe(0);
    expect((await client.workflows.list({ nodeId: watcher })).runs).toEqual([]);
  }, 120_000);

  it("refuses a webhook redirect into a private address", async () => {
    const client = await routerClient();
    const workflowId = await saveWorkflow(
      client,
      "loop-redirect",
      singleHook(`${origin}/redirect-to-metadata`),
    );
    const failed = await client.workflows.start({ nodeId: workflowId });
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/Blocked: target address 169\.254\.169\.254 .*SSRF/);
  }, 120_000);

  it("fails on a non-2xx answer, and keeps going under error policy continue", async () => {
    const client = await routerClient();
    const stop = await saveWorkflow(client, "loop-broken-stop", singleHook(`${origin}/broken`));
    const failed = await client.workflows.start({ nodeId: stop });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe('Webhook step "Hook" (hook) failed: HTTP 500');

    const keepGoing = await saveWorkflow(
      client,
      "loop-broken-continue",
      singleHook(`${origin}/broken`, "continue"),
    );
    const finished = await client.workflows.start({ nodeId: keepGoing });
    expect(finished.status).toBe("completed");
    expect(finished.outputs.hook?.data).toMatchObject({
      executed: false,
      status: 500,
      body: "receiver exploded",
    });
  }, 120_000);
});
