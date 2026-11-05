import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseWorkflowDocument,
  type WorkflowDocument,
} from "busabase-contract/domains/rich-node/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real router + PGlite.
 * - Wait → edit the record → resume: the pre-wait read stays the old head.
 * - A function step runs the saved run_function rule and freezes that result.
 */
describe("workflow wait resume reads the latest record only after the pause", () => {
  let dataDir = "";
  let storageDir = "";

  const routerClient = async () => {
    const { createRouterClient } = await import("@orpc/server");
    const { busabaseRouter } = await import("busabase-core/router");
    return createRouterClient(busabaseRouter);
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-workflow-run-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-workflow-run-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const saveWorkflow = async (
    client: Awaited<ReturnType<typeof routerClient>>,
    slug: string,
    name: string,
    document: WorkflowDocument,
  ) => {
    const workflowNode = await client.nodes.createChangeRequest({
      message: `Add ${name}`,
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "workflow",
          slug,
          name,
          description: "",
        },
      ],
    });
    const nodeId = workflowNode.operations[0]?.nodeId;
    if (!nodeId) throw new Error("Expected a workflow node id");
    await client.nodes.updateContent({
      nodeId,
      message: `Save ${name}`,
      autoMerge: true,
      content: { kind: "workflow", document },
    });
    return nodeId;
  };

  it("keeps the pre-wait snapshot and reloads the edited head", async () => {
    const client = await routerClient();

    const base = await client.bases.create({
      slug: "wait-resume-leads",
      name: "Wait resume leads",
      fields: [{ slug: "status", name: "Status", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    const created = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { status: "new" },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("Expected the lead record to merge");
    const recordId = created.id;

    const workflowNode = await client.nodes.createChangeRequest({
      message: "Add the wait-resume workflow",
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "workflow",
          slug: "wait-resume-flow",
          name: "Wait resume",
          description: "",
        },
      ],
    });
    const nodeId = workflowNode.operations[0]?.nodeId;
    if (!nodeId) throw new Error("Expected a workflow node id");

    const document = parseWorkflowDocument({
      version: 2,
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          label: "Start",
          position: { x: 0, y: 0 },
          eventName: "manual",
        },
        {
          id: "capture",
          kind: "action",
          label: "Capture",
          position: { x: 1, y: 0 },
          actionName: "read_record",
        },
        {
          id: "wait",
          kind: "wait",
          label: "Wait",
          position: { x: 2, y: 0 },
          duration: 0,
          unit: "minutes",
        },
        {
          id: "reload",
          kind: "action",
          label: "Reload",
          position: { x: 3, y: 0 },
          actionName: "read_record",
        },
        {
          id: "done",
          kind: "end",
          label: "Done",
          position: { x: 4, y: 0 },
          outcome: "done",
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "capture", outcome: "default" },
        { id: "e2", source: "capture", target: "wait", outcome: "success" },
        { id: "e3", source: "wait", target: "reload", outcome: "elapsed" },
        { id: "e4", source: "reload", target: "done", outcome: "success" },
      ],
      settings: {},
    });
    await client.nodes.updateContent({
      nodeId,
      message: "Save the wait then reload graph",
      autoMerge: true,
      content: { kind: "workflow", document },
    });

    const paused = await client.workflows.start({ nodeId, recordId });
    expect(paused.status).toBe("waiting");
    expect(paused.outputs.capture?.record?.fields.status).toBe("new");
    const beforeCommit = paused.outputs.capture?.record?.headCommitId;
    expect(beforeCommit).toBeTruthy();

    const edited = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields: { status: "edited" },
      autoMerge: true,
    });
    expect(edited.materialized).toBe(true);
    const current = await client.records.get({ recordId });
    expect(current.headCommit.payload.status).toBe("edited");
    expect(current.headCommit.id).not.toBe(beforeCommit);

    const finished = await client.workflows.resume({ runId: paused.id });
    expect(finished.status).toBe("completed");
    expect(finished.outputs.capture?.record?.fields.status).toBe("new");
    expect(finished.outputs.capture?.record?.headCommitId).toBe(beforeCommit);
    expect(finished.outputs.reload?.record?.fields.status).toBe("edited");
    expect(finished.outputs.reload?.record?.headCommitId).toBe(current.headCommit.id);

    const stored = await client.workflows.get({ runId: paused.id });
    expect(stored.outputs.reload?.record?.fields.status).toBe("edited");
    expect(stored.outputs.capture?.record?.fields.status).toBe("new");
  }, 120_000);

  it("runs a function step and keeps that snapshot after the record changes", async () => {
    const client = await routerClient();
    const base = await client.bases.create({
      slug: "function-score-leads",
      name: "Function score leads",
      fields: [{ slug: "status", name: "Status", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    const created = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { status: "new" },
      autoMerge: true,
    });
    if (!created.materialized) throw new Error("Expected the lead record to merge");

    const rule = await client.webhooks.create({
      name: "scoreLeadFit",
      eventType: "ai_mention",
      enabled: true,
      actionKind: "run_function",
      config: {
        timeoutMs: 2000,
        code: [
          "const fields = input.record && input.record.fields ? input.record.fields : {};",
          'const status = typeof fields.status === "string" ? fields.status : "";',
          'const note = input.payload && typeof input.payload.note === "string" ? input.payload.note : "";',
          'console.log("scored " + status);',
          'return { score: status === "new" ? 91 : 10, note: note, seen: status };',
        ].join("\n"),
      },
    });

    const nodeId = await saveWorkflow(
      client,
      "function-score-flow",
      "Function score",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "score",
            kind: "function",
            label: "Score",
            position: { x: 1, y: 0 },
            webhookRuleId: rule.id,
            functionName: "scoreLeadFit",
          },
          {
            id: "wait",
            kind: "wait",
            label: "Wait",
            position: { x: 2, y: 0 },
            duration: 0,
            unit: "minutes",
          },
          {
            id: "reload",
            kind: "action",
            label: "Reload",
            position: { x: 3, y: 0 },
            actionName: "read_record",
          },
          {
            id: "branch",
            kind: "condition",
            label: "Frozen score, fresh record",
            position: { x: 4, y: 0 },
            expression:
              'steps.score.score == 91 && steps.score.seen == "new" && steps.score.record.fields.status == "new" && input.record.fields.status == "edited"',
          },
          { id: "high", kind: "end", label: "High", position: { x: 5, y: 0 }, outcome: "high" },
          { id: "low", kind: "end", label: "Low", position: { x: 5, y: 1 }, outcome: "low" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "score", outcome: "default" },
          { id: "e2", source: "score", target: "wait", outcome: "success" },
          { id: "e3", source: "wait", target: "reload", outcome: "elapsed" },
          { id: "e4", source: "reload", target: "branch", outcome: "success" },
          { id: "e5", source: "branch", target: "high", outcome: "true" },
          { id: "e6", source: "branch", target: "low", outcome: "false" },
        ],
        settings: {},
      }),
    );

    const paused = await client.workflows.start({
      nodeId,
      recordId: created.id,
      payload: { note: "hello" },
    });
    expect(paused.status).toBe("waiting");
    expect(paused.outputs.score?.data.score).toBe(91);
    expect(paused.outputs.score?.data.note).toBe("hello");
    expect(paused.outputs.score?.data.seen).toBe("new");
    expect(String(paused.outputs.score?.data.logs)).toContain("scored new");
    expect(paused.outputs.score?.record?.fields.status).toBe("new");
    const scoreCommit = paused.outputs.score?.record?.headCommitId;

    await client.records.changeRequest({
      operation: "update",
      recordId: created.id,
      fields: { status: "edited" },
      autoMerge: true,
    });

    const finished = await client.workflows.resume({ runId: paused.id });
    expect(finished.status).toBe("completed");
    expect(finished.outputs.score?.data.score).toBe(91);
    expect(finished.outputs.score?.data.seen).toBe("new");
    expect(finished.outputs.score?.record?.headCommitId).toBe(scoreCommit);
    expect(finished.outputs.reload?.record?.fields.status).toBe("edited");
    expect(finished.outputs.high?.data.outcome).toBe("high");
    expect(finished.outputs.low).toBeUndefined();
    expect(await client.webhooks.deliveries({ ruleId: rule.id })).toEqual([]);
  }, 120_000);

  it("runs a function found by name and fails cleanly when the step is misconfigured", async () => {
    const client = await routerClient();
    const named = await client.webhooks.create({
      name: "scoreByName",
      eventType: "record.created",
      enabled: true,
      actionKind: "run_function",
      config: { timeoutMs: 1000, code: "return { score: 91 };" },
    });
    const byName = await saveWorkflow(
      client,
      "function-by-name",
      "Function by name",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "score",
            kind: "function",
            label: "Score",
            position: { x: 1, y: 0 },
            webhookRuleId: "",
            functionName: "scoreByName",
          },
          { id: "done", kind: "end", label: "Done", position: { x: 2, y: 0 }, outcome: "done" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "score", outcome: "default" },
          { id: "e2", source: "score", target: "done", outcome: "success" },
        ],
        settings: {},
      }),
    );
    const namedRun = await client.workflows.start({ nodeId: byName, payload: {} });
    expect(namedRun.status).toBe("completed");
    expect(namedRun.outputs.score?.data.score).toBe(91);
    expect(namedRun.outputs.score?.data.webhookRuleId).toBe(named.id);
    expect(namedRun.outputs.done?.data.outcome).toBe("done");

    const disabled = await client.webhooks.create({
      name: "scoreDisabled",
      eventType: "record.created",
      enabled: false,
      actionKind: "run_function",
      config: { timeoutMs: 1000, code: "return { score: 1 };" },
    });
    const broken = await saveWorkflow(
      client,
      "function-misconfigured",
      "Function misconfigured",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "missing",
            kind: "function",
            label: "Missing",
            position: { x: 1, y: 0 },
            webhookRuleId: "wh_missing",
            functionName: "",
          },
          { id: "done", kind: "end", label: "Done", position: { x: 2, y: 0 }, outcome: "done" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "missing", outcome: "default" },
          { id: "e2", source: "missing", target: "done", outcome: "success" },
        ],
        settings: {},
      }),
    );
    const missing = await client.workflows.start({ nodeId: broken });
    expect(missing.status).toBe("failed");
    expect(missing.error).toMatch(/Webhook function rule not found: wh_missing/);
    expect(missing.outputs.done).toBeUndefined();

    const emptyNode = await saveWorkflow(
      client,
      "function-empty",
      "Function empty",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "blank",
            kind: "function",
            label: "Blank",
            position: { x: 1, y: 0 },
            webhookRuleId: "",
            functionName: "",
          },
          { id: "done", kind: "end", label: "Done", position: { x: 2, y: 0 }, outcome: "done" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "blank", outcome: "default" },
          { id: "e2", source: "blank", target: "done", outcome: "success" },
        ],
        settings: {},
      }),
    );
    const empty = await client.workflows.start({ nodeId: emptyNode });
    expect(empty.status).toBe("failed");
    expect(empty.error).toMatch(/no webhook rule id or function name/);

    const off = await saveWorkflow(
      client,
      "function-disabled",
      "Function disabled",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "off",
            kind: "function",
            label: "Off",
            position: { x: 1, y: 0 },
            webhookRuleId: disabled.id,
            functionName: "",
          },
          { id: "done", kind: "end", label: "Done", position: { x: 2, y: 0 }, outcome: "done" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "off", outcome: "default" },
          { id: "e2", source: "off", target: "done", outcome: "success" },
        ],
        settings: {},
      }),
    );
    const disabledRun = await client.workflows.start({ nodeId: off });
    expect(disabledRun.status).toBe("failed");
    expect(disabledRun.error).toMatch(/disabled/);

    const spinning = await client.webhooks.create({
      name: "spinForever",
      eventType: "record.created",
      enabled: true,
      actionKind: "run_function",
      config: { timeoutMs: 200, code: "while (true) {}" },
    });
    const slow = await saveWorkflow(
      client,
      "function-timeout",
      "Function timeout",
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: { x: 0, y: 0 },
            eventName: "manual",
          },
          {
            id: "spin",
            kind: "function",
            label: "Spin",
            position: { x: 1, y: 0 },
            webhookRuleId: spinning.id,
            functionName: "",
          },
          { id: "done", kind: "end", label: "Done", position: { x: 2, y: 0 }, outcome: "done" },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "spin", outcome: "default" },
          { id: "e2", source: "spin", target: "done", outcome: "success" },
        ],
        settings: { timeoutMs: 1000 },
      }),
    );
    const timedOut = await client.workflows.start({ nodeId: slow });
    expect(timedOut.status).toBe("failed");
    expect(timedOut.error?.toLowerCase()).toMatch(/timed out|interrupt/);
    expect(timedOut.outputs.done).toBeUndefined();
  }, 120_000);
});
