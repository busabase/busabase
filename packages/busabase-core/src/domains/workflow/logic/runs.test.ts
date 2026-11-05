import { ORPCError } from "@orpc/server";
import { parseWorkflowDocument } from "busabase-contract/domains/rich-node/types";
import {
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DATA_FRESHNESS,
  WORKFLOW_DELETE_RECORD_ACTION,
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_UPDATE_RECORD_ACTION,
} from "busabase-contract/domains/workflow/run";
import { describe, expect, it } from "vitest";
import type { BusabaseNotificationEvent } from "../../../context";
import { createMemoryWorkflowRunStore } from "./run-store";
import {
  cancelQueuedWorkflowRuns,
  cancelWorkflowRun,
  continueDueWorkflowRun,
  decideWorkflowRun,
  failWorkflowRunFromHost,
  getWorkflowRun,
  listWorkflowRuns,
  resumeElapsedWorkflowRuns,
  resumeWorkflowRun,
  startWorkflowRun,
  type WorkflowAccessLevel,
  type WorkflowFunctionCallResult,
  type WorkflowRuntimeDeps,
} from "./runs";

const at = (x: number, y: number) => ({ x, y });

const freshnessGraph = () =>
  parseWorkflowDocument({
    version: 2,
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        label: "Start",
        position: at(0, 0),
        eventName: "manual",
      },
      {
        id: "capture",
        kind: "action",
        label: "Capture",
        position: at(1, 0),
        actionName: WORKFLOW_READ_RECORD_ACTION,
      },
      {
        id: "wait",
        kind: "wait",
        label: "Wait",
        position: at(2, 0),
        duration: 30,
        unit: "minutes",
      },
      {
        id: "reload",
        kind: "action",
        label: "Reload",
        position: at(3, 0),
        actionName: WORKFLOW_READ_RECORD_ACTION,
      },
      {
        id: "branch",
        kind: "condition",
        label: "Latest?",
        position: at(4, 0),
        expression: 'input.record.fields.status == "edited"',
      },
      {
        id: "saw-latest",
        kind: "end",
        label: "Saw latest",
        position: at(5, 0),
        outcome: "saw-latest",
      },
      {
        id: "still-old",
        kind: "end",
        label: "Still old",
        position: at(5, 1),
        outcome: "still-old",
      },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "capture", outcome: "default" },
      { id: "e2", source: "capture", target: "wait", outcome: "success" },
      { id: "e3", source: "wait", target: "reload", outcome: "elapsed" },
      { id: "e4", source: "reload", target: "branch", outcome: "success" },
      { id: "e5", source: "branch", target: "saw-latest", outcome: "true" },
      { id: "e6", source: "branch", target: "still-old", outcome: "false" },
    ],
    settings: {},
  });

interface LiveRecord {
  recordId: string;
  baseId: string;
  headCommitId: string;
  fields: { status: string; owner: string };
}

const harness = (document = freshnessGraph()) => {
  let now = Date.parse("2026-10-29T00:00:00.000Z");
  let nextId = 0;
  const live: LiveRecord = {
    recordId: "rec_lead",
    baseId: "bas_leads",
    headCommitId: "cmt_before",
    fields: { status: "new", owner: "ada" },
  };
  let current = document;
  const access: Array<{ nodeId: string; level: WorkflowAccessLevel }> = [];
  /** The caller's level on the workflow node. Lower than asked → FORBIDDEN. */
  let grant: WorkflowAccessLevel | null = "write";
  /** Whether the caller is one of an approval step's named approvers. */
  let namedApprover = false;
  const approverChecks: string[][] = [];
  const notifications: BusabaseNotificationEvent[] = [];
  const updates: { recordId: string; fields: Record<string, unknown>; message: string }[] = [];
  let updateOutcome: "merged" | "review" | "error" = "merged";
  const creates: { baseId: string; fields: Record<string, unknown>; message: string }[] = [];
  const deletes: string[] = [];
  let recordGone = false;
  const deps: WorkflowRuntimeDeps = {
    spaceId: "spc_test",
    actorId: "usr_ada",
    store: createMemoryWorkflowRunStore(),
    now: () => now,
    createId: () => {
      nextId += 1;
      return `wfr_test_${nextId}`;
    },
    readRecord: async () => (recordGone ? null : { ...live, fields: structuredClone(live.fields) }),
    updateRecord: async (recordId, fields, message) => {
      updates.push({ recordId, fields, message });
      if (updateOutcome === "review") return { merged: false, changeRequestId: "crq_review" };
      if (updateOutcome === "error") throw new Error("Field is invalid: status");
      if (recordId !== live.recordId) {
        return {
          merged: true,
          record: { recordId, baseId: "bas_other", headCommitId: "cmt_other", fields },
        };
      }
      Object.assign(live.fields, fields);
      live.headCommitId = `cmt_${updates.length}`;
      return {
        merged: true,
        record: { ...live, fields: structuredClone(live.fields) },
      };
    },
    authorizeWorkflow: async (nodeId, level) => {
      access.push({ nodeId, level });
      if (grant === null)
        throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
      if (level === "write" && grant === "read") {
        throw new ORPCError("FORBIDDEN", { message: "Requires write access on this node" });
      }
      return "nod_workflow";
    },
    canDriveWorkflow: async () => grant === "write",
    createRecord: async (baseId, fields, message) => {
      creates.push({ baseId, fields, message });
      if (updateOutcome === "review") return { merged: false, changeRequestId: "crq_review" };
      if (updateOutcome === "error") throw new Error("Base refused it");
      return {
        merged: true,
        record: { recordId: "rec_new", baseId, headCommitId: "cmt_new", fields },
      };
    },
    deleteRecord: async (recordId) => {
      deletes.push(recordId);
      if (updateOutcome === "review") return { merged: false, changeRequestId: "crq_review" };
      if (updateOutcome === "error") throw new Error("Already archived");
      if (recordId === live.recordId) recordGone = true;
      return { merged: true };
    },
    resolveActorNames: async (ids) => Object.fromEntries(ids.map((id) => [id, `Name of ${id}`])),
    notify: async (event) => {
      notifications.push(event);
    },
    background: false,
    agent: null,
    isNamedApprover: async (approvers) => {
      approverChecks.push([...approvers]);
      return namedApprover;
    },
    loadDocument: async () => current,
    executeFunction: async () => {
      throw new Error("executeFunction was not expected");
    },
    sendWebhook: async () => {
      throw new Error("sendWebhook was not expected");
    },
  };
  return {
    deps,
    live,
    access,
    setGrant: (level: WorkflowAccessLevel | null) => {
      grant = level;
    },
    setNamedApprover: (value: boolean) => {
      namedApprover = value;
    },
    approverChecks,
    notifications,
    updates,
    creates,
    deletes,
    setUpdateOutcome: (value: "merged" | "review" | "error") => {
      updateOutcome = value;
    },
    setNow: (ms: number) => {
      now = ms;
    },
    now: () => now,
    replaceDocument: (next: typeof document) => {
      current = next;
    },
  };
};

describe("workflow wait / resume freshness", () => {
  it("keeps the pre-wait snapshot and lets a later read_record see the edit", async () => {
    const { deps, live } = harness();
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });

    expect(paused.status).toBe("waiting");
    expect(paused.freshness).toBe(WORKFLOW_DATA_FRESHNESS);
    expect(paused.pause).toMatchObject({ kind: "wait", nodeId: "wait" });
    expect(paused.outputs.capture?.record?.fields.status).toBe("new");
    expect(paused.outputs.capture?.record?.headCommitId).toBe("cmt_before");
    expect(paused.outputs.trigger?.record?.fields.status).toBe("new");

    live.fields.status = "edited";
    live.fields.owner = "bea";
    live.headCommitId = "cmt_after";

    expect(paused.outputs.capture?.record?.fields).toEqual({ status: "new", owner: "ada" });

    await expect(resumeWorkflowRun(deps, { runId: paused.id })).rejects.toBeInstanceOf(ORPCError);
    const stillWaiting = await deps.store.get(paused.id);
    expect(stillWaiting?.status).toBe("waiting");

    const finished = await resumeWorkflowRun(deps, { runId: paused.id, force: true });

    expect(finished.status).toBe("completed");
    expect(finished.cursorNodeId).toBeNull();
    expect(finished.outputs.capture?.record?.fields).toEqual({ status: "new", owner: "ada" });
    expect(finished.outputs.capture?.record?.headCommitId).toBe("cmt_before");
    expect(finished.outputs.reload?.record?.fields).toEqual({ status: "edited", owner: "bea" });
    expect(finished.outputs.reload?.record?.headCommitId).toBe("cmt_after");
    expect(finished.outputs.branch?.data.value).toBe(true);
    expect(finished.outputs["saw-latest"]?.data.outcome).toBe("saw-latest");
    expect(finished.outputs["still-old"]).toBeUndefined();
    expect(finished.outputs.wait?.data.forced).toBe(true);
  });

  it("does not silently re-read when the step after Wait branches on an earlier snapshot", async () => {
    const graph = parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
        {
          id: "capture",
          kind: "action",
          label: "Capture",
          position: at(1, 0),
          actionName: WORKFLOW_READ_RECORD_ACTION,
        },
        {
          id: "wait",
          kind: "wait",
          label: "Wait",
          position: at(2, 0),
          duration: 30,
          unit: "minutes",
        },
        {
          id: "branch",
          kind: "condition",
          label: "Still the snapshot?",
          position: at(3, 0),
          expression: 'steps.capture.record.fields.status == "new"',
        },
        { id: "kept", kind: "end", label: "Kept", position: at(4, 0), outcome: "kept" },
        { id: "changed", kind: "end", label: "Changed", position: at(4, 1), outcome: "changed" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "capture", outcome: "default" },
        { id: "e2", source: "capture", target: "wait", outcome: "success" },
        { id: "e3", source: "wait", target: "branch", outcome: "elapsed" },
        { id: "e4", source: "branch", target: "kept", outcome: "true" },
        { id: "e5", source: "branch", target: "changed", outcome: "false" },
      ],
      settings: {},
    });
    const { deps, live, setNow, now } = harness(graph);
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(paused.status).toBe("waiting");
    live.fields.status = "edited";
    live.headCommitId = "cmt_after";
    setNow(now() + 30 * 60_000);

    const finished = (await resumeElapsedWorkflowRuns(deps)).runs[0];

    expect(finished?.status).toBe("completed");
    expect(finished?.outputs.kept?.data.outcome).toBe("kept");
    expect(finished?.outputs.changed).toBeUndefined();
    expect(finished?.outputs.capture?.record?.fields.status).toBe("new");
    expect(finished?.outputs.wait?.data.forced).toBe(false);
    expect(live.fields.status).toBe("edited");
  });

  it("re-reads after an approval, and leaves the trigger snapshot untouched", async () => {
    const graph = parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
        { id: "approval", kind: "approval", label: "Approve", position: at(1, 0), approver: "ada" },
        {
          id: "reload",
          kind: "action",
          label: "Reload",
          position: at(2, 0),
          actionName: WORKFLOW_READ_RECORD_ACTION,
        },
        { id: "done", kind: "end", label: "Done", position: at(3, 0), outcome: "done" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "approval", outcome: "default" },
        { id: "e2", source: "approval", target: "reload", outcome: "approved" },
        { id: "e3", source: "reload", target: "done", outcome: "success" },
      ],
      settings: {},
    });
    const { deps, live } = harness(graph);
    const { decideWorkflowRun } = await import("./runs");
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(paused.status).toBe("waiting_approval");
    live.fields.status = "approved-edit";
    live.headCommitId = "cmt_review";

    const finished = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });

    expect(finished.outputs.trigger?.record?.fields.status).toBe("new");
    expect(finished.outputs.reload?.record?.fields.status).toBe("approved-edit");
    expect(finished.outputs.reload?.record?.headCommitId).toBe("cmt_review");
    expect(finished.status).toBe("completed");
  });

  it("uses the current graph for steps that have not run, without recomputing finished steps", async () => {
    const { deps, live, replaceDocument } = harness();
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    replaceDocument(
      parseWorkflowDocument({
        version: 2,
        nodes: [
          {
            id: "trigger",
            kind: "trigger",
            label: "Start",
            position: at(0, 0),
            eventName: "manual",
          },
          {
            id: "capture",
            kind: "action",
            label: "Capture",
            position: at(1, 0),
            actionName: WORKFLOW_READ_RECORD_ACTION,
          },
          {
            id: "wait",
            kind: "wait",
            label: "Wait",
            position: at(2, 0),
            duration: 30,
            unit: "minutes",
          },
          {
            id: "renamed-end",
            kind: "end",
            label: "Renamed",
            position: at(3, 0),
            outcome: "renamed",
          },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "capture", outcome: "default" },
          { id: "e2", source: "capture", target: "wait", outcome: "success" },
          { id: "e3", source: "wait", target: "renamed-end", outcome: "elapsed" },
        ],
        settings: {},
      }),
    );
    live.fields.status = "edited";

    const finished = await resumeWorkflowRun(deps, { runId: paused.id, force: true });

    expect(finished.outputs.capture?.record?.fields.status).toBe("new");
    expect(finished.outputs["renamed-end"]?.data.outcome).toBe("renamed");
    expect(finished.outputs.reload).toBeUndefined();
  });
});

const webhookGraph = (url: string, errorPolicy: "stop" | "continue" = "stop") =>
  parseWorkflowDocument({
    version: 2,
    nodes: [
      { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
      { id: "hook", kind: "webhook", label: "Enrich", position: at(1, 0), method: "POST", url },
      {
        id: "branch",
        kind: "condition",
        label: "Accepted?",
        position: at(2, 0),
        expression: "input.status == 202 && input.body.accepted == true",
      },
      { id: "yes", kind: "end", label: "Yes", position: at(3, 0), outcome: "accepted" },
      { id: "no", kind: "end", label: "No", position: at(3, 1), outcome: "rejected" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "hook", outcome: "default" },
      { id: "e2", source: "hook", target: "branch", outcome: "success" },
      { id: "e3", source: "branch", target: "yes", outcome: "true" },
      { id: "e4", source: "branch", target: "no", outcome: "false" },
    ],
    settings: { errorPolicy },
  });

describe("workflow webhook steps", () => {
  it("sends the run's data and branches on the response", async () => {
    const { deps, live } = harness(webhookGraph("https://hooks.example.com/enrich"));
    const sent: Array<Parameters<WorkflowRuntimeDeps["sendWebhook"]>[0]> = [];
    deps.sendWebhook = async (call) => {
      sent.push(call);
      return { ok: true, status: 202, body: { accepted: true }, durationMs: 12 };
    };

    const finished = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
      payload: { source: "form" },
    });

    expect(finished.status).toBe("completed");
    expect(finished.outputs.yes?.data.outcome).toBe("accepted");
    expect(finished.outputs.hook?.data).toMatchObject({
      executed: true,
      method: "POST",
      status: 202,
      body: { accepted: true },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.url).toBe("https://hooks.example.com/enrich");
    expect(sent[0]?.body).toMatchObject({
      event: "workflow.step",
      runId: finished.id,
      stepId: "hook",
      payload: { source: "form" },
      recordId: "rec_lead",
      baseId: "bas_leads",
      fields: { status: "new", owner: "ada" },
    });
    expect(sent[0]?.body.previous?.kind).toBe("trigger");
  });

  it("fails the run on a non-2xx answer but keeps what the receiver said", async () => {
    const { deps } = harness(webhookGraph("https://hooks.example.com/enrich"));
    deps.sendWebhook = async () => ({
      ok: false,
      message: "HTTP 500",
      status: 500,
      body: "boom",
      durationMs: 3,
    });
    const failed = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe('Webhook step "Enrich" (hook) failed: HTTP 500');
    expect(failed.outputs.yes).toBeUndefined();
  });

  it("records the failure and takes the success branch under error policy continue", async () => {
    const { deps } = harness(webhookGraph("https://hooks.example.com/enrich", "continue"));
    deps.sendWebhook = async () => ({
      ok: false,
      message: "No answer within 30000 ms",
      status: null,
      body: null,
      durationMs: 30_000,
    });
    const finished = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(finished.status).toBe("completed");
    expect(finished.outputs.hook?.data).toMatchObject({
      executed: false,
      error: "No answer within 30000 ms",
    });
    expect(finished.outputs.no?.data.outcome).toBe("rejected");
  });

  it("does not call anything when the step has no URL", async () => {
    const { deps } = harness(webhookGraph("  "));
    const failed = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe('Webhook step "Enrich" (hook) has no URL.');
  });
});

const functionGraph = () =>
  parseWorkflowDocument({
    version: 2,
    nodes: [
      { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
      {
        id: "score",
        kind: "function",
        label: "Score",
        position: at(1, 0),
        webhookRuleId: "wh_score",
        functionName: "scoreLeadFit",
      },
      {
        id: "reload",
        kind: "action",
        label: "Reload",
        position: at(2, 0),
        actionName: WORKFLOW_READ_RECORD_ACTION,
      },
      {
        id: "branch",
        kind: "condition",
        label: "High score and a later edit?",
        position: at(3, 0),
        expression:
          'steps.score.score == 91 && steps.score.record.fields.status == "new" && input.record.fields.status == "edited"',
      },
      { id: "high", kind: "end", label: "High", position: at(4, 0), outcome: "high" },
      { id: "low", kind: "end", label: "Low", position: at(4, 1), outcome: "low" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "score", outcome: "default" },
      { id: "e2", source: "score", target: "reload", outcome: "success" },
      { id: "e3", source: "reload", target: "branch", outcome: "success" },
      { id: "e4", source: "branch", target: "high", outcome: "true" },
      { id: "e5", source: "branch", target: "low", outcome: "false" },
    ],
    settings: {},
  });

describe("workflow function steps", () => {
  it("runs the function, freezes its snapshot, and lets the next step see the return value", async () => {
    const { deps, live } = harness(functionGraph());
    const calls: string[] = [];
    deps.executeFunction = async (call) => {
      calls.push(call.webhookRuleId);
      expect(call.timeoutMs).toBe(30_000);
      expect(call.recordBaseId).toBe(live.baseId);
      expect(call.input.payload).toEqual({ note: "hello" });
      expect(call.input.record?.fields.status).toBe("new");
      expect(call.input.record?.headCommitId).toBe("cmt_before");
      expect(call.input.previous?.kind).toBe("trigger");
      // The same names a record webhook rule receives, so one body serves both.
      expect(call.input).toMatchObject({
        event: "workflow.step",
        stepId: "score",
        recordId: "rec_lead",
        baseId: "bas_leads",
        fields: { status: "new" },
      });
      const seen = call.input.record?.fields.status;
      live.fields.status = "edited";
      live.headCommitId = "cmt_after";
      return {
        ok: true,
        ruleId: "wh_score",
        functionName: "scoreLeadFit",
        result: { score: 91, seen },
        logs: "scored",
      } satisfies WorkflowFunctionCallResult;
    };

    const finished = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
      payload: { note: "hello" },
    });

    expect(calls).toEqual(["wh_score"]);
    expect(finished.status).toBe("completed");
    expect(finished.outputs.score?.data.score).toBe(91);
    expect(finished.outputs.score?.data.seen).toBe("new");
    expect(finished.outputs.score?.data.logs).toBe("scored");
    expect(finished.outputs.score?.data.result).toEqual({ score: 91, seen: "new" });
    expect(finished.outputs.score?.record?.fields.status).toBe("new");
    expect(finished.outputs.score?.record?.headCommitId).toBe("cmt_before");
    expect(finished.outputs.reload?.record?.fields.status).toBe("edited");
    expect(finished.outputs.reload?.record?.headCommitId).toBe("cmt_after");
    expect(finished.outputs.high?.data.outcome).toBe("high");
    expect(finished.outputs.low).toBeUndefined();
    // Execution order is recorded, not inferred from timestamps or key order.
    expect(
      Object.entries(finished.outputs)
        .sort(([, a], [, b]) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map(([id]) => id),
    ).toEqual(["trigger", "score", "reload", "branch", "high"]);

    live.fields.status = "later";
    expect(finished.outputs.score?.data.seen).toBe("new");
    expect(finished.outputs.score?.record?.fields.status).toBe("new");
  });

  it("fails the run when the function is misconfigured", async () => {
    const { deps, live } = harness(functionGraph());
    deps.executeFunction = async () => ({
      ok: false,
      message: "Webhook function rule not found: wh_score",
    });

    const failed = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });

    expect(failed.status).toBe("failed");
    expect(failed.error).toBe(
      'Function step "Score" (score) failed: Webhook function rule not found: wh_score',
    );
    expect(failed.outputs.reload).toBeUndefined();
    expect(failed.outputs.score).toBeUndefined();
  });

  it("records a function failure and continues when the error policy says so", async () => {
    const graph = parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
        {
          id: "score",
          kind: "function",
          label: "Score",
          position: at(1, 0),
          webhookRuleId: "",
          functionName: "",
        },
        { id: "done", kind: "end", label: "Done", position: at(2, 0), outcome: "done" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "score", outcome: "default" },
        { id: "e2", source: "score", target: "done", outcome: "success" },
      ],
      settings: { errorPolicy: "continue" },
    });
    const { deps } = harness(graph);
    deps.executeFunction = async () => ({
      ok: false,
      message: "Function step has no webhook rule id or function name.",
    });

    const finished = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(finished.status).toBe("completed");
    expect(finished.outputs.score?.data.executed).toBe(false);
    expect(finished.outputs.score?.data.error).toMatch(/no webhook rule id/);
    expect(finished.outputs.done?.data.outcome).toBe("done");
  });

  it("fails cleanly when the function host throws", async () => {
    const { deps, live } = harness(functionGraph());
    deps.executeFunction = async () => {
      throw new Error("sandbox unavailable");
    };

    const failed = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });

    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/sandbox unavailable/);
    expect(failed.outputs.reload).toBeUndefined();
  });
});

const approvalGraph = () =>
  parseWorkflowDocument({
    version: 2,
    nodes: [
      { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
      { id: "review", kind: "approval", label: "Review", position: at(1, 0), approver: "lead" },
      { id: "ok", kind: "end", label: "OK", position: at(2, 0), outcome: "approved" },
      { id: "no", kind: "end", label: "No", position: at(2, 1), outcome: "rejected" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "review", outcome: "default" },
      { id: "e2", source: "review", target: "ok", outcome: "approved" },
      { id: "e3", source: "review", target: "no", outcome: "rejected" },
    ],
    settings: {},
  });

describe("workflow run permissions", () => {
  it("needs write to start, and a read-only member cannot start one", async () => {
    const { deps, access, setGrant } = harness();
    setGrant("read");
    await expect(startWorkflowRun(deps, { nodeId: "nod_workflow" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(access).toEqual([{ nodeId: "nod_workflow", level: "write" }]);
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).runs).toEqual([]);
  });

  it("lets a reader see runs but not approve them", async () => {
    const { deps, access, setGrant } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(paused.status).toBe("waiting_approval");
    expect(paused.startedBy).toBe("usr_ada");
    expect(paused.trigger).toBe("manual");

    setGrant("read");
    access.length = 0;
    expect((await getWorkflowRun(deps, paused.id)).id).toBe(paused.id);
    expect(await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).toMatchObject({
      runs: [{ id: paused.id }],
      canRun: false,
    });
    await expect(
      decideWorkflowRun(deps, { runId: paused.id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resumeWorkflowRun(deps, { runId: paused.id, force: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // decide reaches the step with read, then needs write because the step names nobody.
    expect(access.map((entry) => entry.level)).toEqual(["read", "read", "read", "write"]);
    expect((await getWorkflowRun(deps, paused.id)).status).toBe("waiting_approval");

    setGrant("write");
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).canRun).toBe(true);
    deps.actorId = "usr_lead";
    const approved = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });
    expect(approved.status).toBe("completed");
    expect(approved.outputs.review?.data).toMatchObject({
      decision: "approved",
      decidedBy: "usr_lead",
    });
    expect(approved.outputs.ok?.data.outcome).toBe("approved");
  });

  it("hides a run from a caller who cannot see its workflow", async () => {
    const { deps, setGrant } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    setGrant(null);
    await expect(getWorkflowRun(deps, paused.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides a run from another space", async () => {
    const { deps } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    deps.spaceId = "spc_other";
    await expect(getWorkflowRun(deps, paused.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("workflow run leases", () => {
  it("refuses to advance a run another worker holds, then allows it once released", async () => {
    const { deps, now } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(await deps.store.claim(paused.id, now(), now() + 60_000)).toBe(true);

    await expect(
      decideWorkflowRun(deps, { runId: paused.id, decision: "rejected" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await deps.store.release(paused.id);
    const rejected = await decideWorkflowRun(deps, { runId: paused.id, decision: "rejected" });
    expect(rejected.outputs.no?.data.outcome).toBe("rejected");
  });

  it("fails a run whose worker vanished mid-step, and leaves finished runs alone", async () => {
    const { deps, now } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    await deps.store.save({ ...paused, status: "running" });

    expect(await deps.store.listInterrupted(now(), 10)).toHaveLength(1);
    expect(
      (await failWorkflowRunFromHost(deps.store, paused.id, now(), "gone", ["running"]))?.status,
    ).toBe("failed");
    const failed = await getWorkflowRun(deps, paused.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("gone");
    expect(
      await failWorkflowRunFromHost(deps.store, paused.id, now(), "again", ["running"]),
    ).toBeNull();
  });
});

describe("scheduler: queued event runs and elapsed waits", () => {
  const queue = async (deps: WorkflowRuntimeDeps, cursorNodeId: string, startedAt: string) => {
    const run = {
      id: deps.createId(),
      spaceId: deps.spaceId,
      workflowNodeId: "nod_workflow",
      status: "queued" as const,
      trigger: "event" as const,
      startedBy: "usr_armer",
      startedVia: null,
      cancelledBy: null,
      cursorNodeId,
      previousNodeId: null,
      outputs: {},
      recordId: "rec_lead",
      payload: { event: "record.created", recordId: "rec_lead" },
      pause: null,
      error: null,
      freshness: WORKFLOW_DATA_FRESHNESS,
      startedAt,
      updatedAt: startedAt,
    };
    await deps.store.insert(run, 0);
    await deps.store.release(run.id);
    return run;
  };

  it("starts a queued run from its trigger and pauses at the Wait", async () => {
    const { deps, now, access } = harness();
    const queued = await queue(deps, "trigger", new Date(now()).toISOString());
    expect((await deps.store.listDue(now(), 10)).map((run) => run.id)).toEqual([queued.id]);

    const paused = await continueDueWorkflowRun(deps, queued.id);
    expect(paused?.status).toBe("waiting");
    expect(paused?.trigger).toBe("event");
    expect(paused?.startedBy).toBe("usr_armer");
    expect(paused?.outputs.trigger?.record?.fields.status).toBe("new");
    expect(access).toEqual([{ nodeId: "nod_workflow", level: "write" }]);
    expect(await deps.store.listDue(now(), 10)).toEqual([]);
  });

  it("resumes a Wait only after its time, as the run's own actor", async () => {
    const { deps, live, now, setNow } = harness();
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(await continueDueWorkflowRun(deps, paused.id)).toBeNull();

    live.fields.status = "edited";
    setNow(now() + 31 * 60_000);
    expect((await deps.store.listDue(now(), 10)).map((run) => run.id)).toEqual([paused.id]);
    const finished = await continueDueWorkflowRun(deps, paused.id);
    expect(finished?.status).toBe("completed");
    expect(finished?.outputs.wait?.data.forced).toBe(false);
    expect(finished?.outputs["saw-latest"]?.data.outcome).toBe("saw-latest");
  });

  it("fails a queued run with a reason when its actor lost access, instead of retrying forever", async () => {
    const { deps, now, setGrant } = harness();
    const queued = await queue(deps, "trigger", new Date(now()).toISOString());
    setGrant("read");
    const failed = await continueDueWorkflowRun(deps, queued.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/^Could not start: Requires write access/);
    expect(await deps.store.listDue(now(), 10)).toEqual([]);
  });

  it("fails a queued run whose trigger was removed from the graph", async () => {
    const { deps, now } = harness();
    const queued = await queue(deps, "gone-trigger", new Date(now()).toISOString());
    const failed = await continueDueWorkflowRun(deps, queued.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/trigger that queued this run is no longer/);
  });

  it("keeps going when one elapsed Wait cannot be resumed", async () => {
    const { deps, live, now, setNow } = harness();
    const first = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    const second = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    setNow(now() + 31 * 60_000);
    await deps.store.claim(first.id, now(), now() + 60_000);

    const result = await resumeElapsedWorkflowRuns(deps);
    expect(result.runs.map((run) => run.id)).toEqual([second.id]);
    expect(result.failed).toEqual([{ runId: first.id, message: "This run is already advancing" }]);
  });
});

const namedApprovalGraph = () =>
  parseWorkflowDocument({
    version: 2,
    nodes: [
      { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0), eventName: "manual" },
      {
        id: "review",
        kind: "approval",
        label: "Sales lead",
        position: at(1, 0),
        approver: "Lead@Example.com, ops@example.com",
      },
      {
        id: "reload",
        kind: "action",
        label: "Reload",
        position: at(2, 0),
        actionName: WORKFLOW_READ_RECORD_ACTION,
      },
      { id: "ok", kind: "end", label: "OK", position: at(3, 0), outcome: "approved" },
      { id: "no", kind: "end", label: "No", position: at(3, 1), outcome: "rejected" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "review", outcome: "default" },
      { id: "e2", source: "review", target: "reload", outcome: "approved" },
      { id: "e3", source: "reload", target: "ok", outcome: "success" },
      { id: "e4", source: "review", target: "no", outcome: "rejected" },
    ],
    settings: {},
  });

describe("approval steps that name their approvers", () => {
  it("refuses an editor who is not named, even though they can edit the workflow", async () => {
    const { deps, live, approverChecks } = harness(namedApprovalGraph());
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(paused.status).toBe("waiting_approval");

    expect(await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).toMatchObject({
      canRun: true,
      decidableRunIds: [],
    });
    await expect(
      decideWorkflowRun(deps, { runId: paused.id, decision: "approved" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/Only the approvers named on "Sales lead"/),
    });
    expect(approverChecks.at(-1)).toEqual(["lead@example.com", "ops@example.com"]);
    expect((await getWorkflowRun(deps, paused.id)).status).toBe("waiting_approval");
  });

  it("lets a named approver with read only decide, then hands the rest to the scheduler as the starter", async () => {
    const { deps, live, setGrant, setNamedApprover } = harness(namedApprovalGraph());
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });

    // The approver can read the workflow but not edit it.
    setGrant("read");
    setNamedApprover(true);
    deps.actorId = "usr_lead";
    expect(await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).toMatchObject({
      canRun: false,
      decidableRunIds: [paused.id],
    });
    const decided = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });
    // Decision recorded; nothing after it ran with the approver's access.
    expect(decided.status).toBe("queued");
    expect(decided.cursorNodeId).toBe("reload");
    expect(decided.outputs.review?.data).toMatchObject({
      decision: "approved",
      decidedBy: "usr_lead",
    });
    expect(decided.outputs.reload).toBeUndefined();

    // The scheduler continues as the person who started the run.
    setGrant("write");
    setNamedApprover(false);
    deps.actorId = "usr_ada";
    const finished = await continueDueWorkflowRun(deps, paused.id);
    expect(finished?.status).toBe("completed");
    expect(finished?.outputs.reload?.record?.fields.status).toBe("new");
    expect(finished?.outputs.ok?.data.outcome).toBe("approved");
    expect(
      Object.entries(finished?.outputs ?? {})
        .sort(([, a], [, b]) => (a.sequence ?? 0) - (b.sequence ?? 0))
        .map(([id]) => id),
    ).toEqual(["trigger", "review", "reload", "ok"]);
  });

  it("keeps a plain name as a label: no email means editors decide, as before", async () => {
    const graph = namedApprovalGraph();
    const review = graph.nodes.find((node) => node.id === "review");
    if (review?.kind === "approval") review.approver = "Sales lead";
    const { deps, live, approverChecks } = harness(graph);
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).decidableRunIds).toEqual([
      paused.id,
    ]);
    const approved = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });
    expect(approved.status).toBe("completed");
    expect(approverChecks).toEqual([]);
  });

  it("continues at once when the named approver can also edit the workflow", async () => {
    const { deps, live, setNamedApprover } = harness(namedApprovalGraph());
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    setNamedApprover(true);
    const rejected = await decideWorkflowRun(deps, { runId: paused.id, decision: "rejected" });
    expect(rejected.status).toBe("completed");
    expect(rejected.outputs.no?.data.outcome).toBe("rejected");
  });
});

describe("workflow concurrency", () => {
  const busyRun = (deps: WorkflowRuntimeDeps, startedAt: string) => ({
    id: "wfr_busy",
    spaceId: deps.spaceId,
    workflowNodeId: "nod_workflow",
    status: "running" as const,
    trigger: "manual" as const,
    startedBy: "usr_other",
    startedVia: null,
    cancelledBy: null,
    cursorNodeId: "capture",
    previousNodeId: "trigger",
    outputs: {},
    recordId: null,
    payload: {},
    pause: null,
    error: null,
    freshness: WORKFLOW_DATA_FRESHNESS,
    startedAt,
    updatedAt: startedAt,
  });

  it("queues a manual start while another run of the workflow is executing, and starts it once that one is done", async () => {
    // concurrency defaults to 1
    const { deps, live, now } = harness();
    const busy = busyRun(deps, new Date(now()).toISOString());
    await deps.store.insert(busy, now() + 60_000);

    const queued = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(queued.status).toBe("queued");
    expect(queued.trigger).toBe("manual");
    expect(queued.outputs).toEqual({});
    // Still full: the scheduler leaves it queued.
    expect(await continueDueWorkflowRun(deps, queued.id)).toBeNull();
    expect((await getWorkflowRun(deps, queued.id)).status).toBe("queued");

    await deps.store.save({ ...busy, status: "completed" });
    const started = await continueDueWorkflowRun(deps, queued.id);
    expect(started?.status).toBe("waiting");
    expect(started?.outputs.capture?.record?.fields.status).toBe("new");
  });

  it("does not count runs paused on a Wait or an approval", async () => {
    const { deps, live } = harness();
    const first = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(first.status).toBe("waiting");
    const second = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(second.status).toBe("waiting");
  });

  it("lets more run at once when concurrency allows it", async () => {
    const graph = freshnessGraph();
    graph.settings.concurrency = 2;
    const { deps, live, now } = harness(graph);
    await deps.store.insert(busyRun(deps, new Date(now()).toISOString()), now() + 60_000);
    const started = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(started.status).toBe("waiting");
  });
});

describe("cancelling runs", () => {
  it("stops a paused run for good and records who did it", async () => {
    const { deps, live } = harness();
    const waiting = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(waiting.status).toBe("waiting");

    const cancelled = await cancelWorkflowRun(deps, { runId: waiting.id });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledBy).toBe(deps.actorId);
    expect(cancelled.pause).toBeNull();

    // Nothing can bring it back: not the scheduler, not a manual continue.
    expect(await continueDueWorkflowRun(deps, waiting.id)).toBeNull();
    await expect(resumeWorkflowRun(deps, { runId: waiting.id, force: true })).rejects.toBeDefined();
    await expect(cancelWorkflowRun(deps, { runId: waiting.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a run that is executing a step, because that step cannot be taken back", async () => {
    const { deps, live, now } = harness();
    const waiting = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    await deps.store.save({ ...waiting, status: "running" });
    await expect(cancelWorkflowRun(deps, { runId: waiting.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await getWorkflowRun(deps, waiting.id)).status).toBe("running");

    // A live lease (a worker mid-step) gets the same answer.
    await deps.store.claim(waiting.id, now(), now() + 60_000);
    await expect(cancelWorkflowRun(deps, { runId: waiting.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("needs write on the workflow", async () => {
    const { deps, live, setGrant } = harness();
    const waiting = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    setGrant("read");
    await expect(cancelWorkflowRun(deps, { runId: waiting.id })).rejects.toBeDefined();
    await expect(cancelQueuedWorkflowRuns(deps, { nodeId: "nod_workflow" })).rejects.toBeDefined();
    expect((await getWorkflowRun(deps, waiting.id)).status).toBe("waiting");
  });

  it("cancels every queued run at once and leaves paused ones alone", async () => {
    const graph = freshnessGraph();
    const { deps, live, now } = harness(graph);
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    const iso = new Date(now()).toISOString();
    for (const id of ["wfr_q1", "wfr_q2", "wfr_q3"]) {
      await deps.store.insert(
        {
          ...paused,
          id,
          status: "queued",
          pause: null,
          trigger: "event",
          outputs: {},
          startedAt: iso,
          updatedAt: iso,
        },
        now() - 1,
      );
    }
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).queuedCount).toBe(3);

    expect(await cancelQueuedWorkflowRuns(deps, { nodeId: "nod_workflow" })).toEqual({
      cancelled: 3,
    });
    const listed = await listWorkflowRuns(deps, { nodeId: "nod_workflow" });
    expect(listed.queuedCount).toBe(0);
    expect(listed.actorNames[deps.actorId]).toBe(`Name of ${deps.actorId}`);
    expect((await getWorkflowRun(deps, "wfr_q2")).cancelledBy).toBe(deps.actorId);
    expect((await getWorkflowRun(deps, paused.id)).status).toBe("waiting");
  });
});

describe("listing runs page by page", () => {
  const seed = async (deps: WorkflowRuntimeDeps, count: number) => {
    const base = await startWorkflowRun(deps, { nodeId: "nod_workflow" }).catch(() => null);
    const template = base ?? (await deps.store.listForWorkflow(deps.spaceId, "nod_workflow", 1))[0];
    if (!template) throw new Error("no run to copy");
    for (let index = 0; index < count; index += 1) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      await deps.store.insert(
        { ...template, id: `wfr_page_${index}`, status: "completed", startedAt: at, updatedAt: at },
        0,
      );
    }
    return template;
  };

  it("walks every run exactly once, newest first", async () => {
    const { deps } = harness(approvalGraph());
    const template = await seed(deps, 5);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listWorkflowRuns(deps, { nodeId: "nod_workflow", limit: 2, cursor });
      seen.push(...page.runs.map((run) => run.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual([
      template.id,
      "wfr_page_4",
      "wfr_page_3",
      "wfr_page_2",
      "wfr_page_1",
      "wfr_page_0",
    ]);
  });

  it("rejects a cursor it did not issue", async () => {
    const { deps } = harness(approvalGraph());
    await expect(
      listWorkflowRuns(deps, { nodeId: "nod_workflow", cursor: "nonsense" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers for one linked run with what the caller may do to it, inside this workflow only", async () => {
    const { deps } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    await seed(deps, 30);
    const linked = await listWorkflowRuns(deps, { nodeId: "nod_workflow", runId: paused.id });
    expect(linked.runs.map((run) => run.id)).toEqual([paused.id]);
    expect(linked.decidableRunIds).toEqual([paused.id]);
    expect(linked.nextCursor).toBeNull();

    await deps.store.save({ ...paused, workflowNodeId: "nod_other" });
    const elsewhere = await listWorkflowRuns(deps, { nodeId: "nod_workflow", runId: paused.id });
    expect(elsewhere.runs).toEqual([]);
  });
});

describe("retention", () => {
  it("deletes only finished runs older than the cutoff", async () => {
    const { deps, now } = harness(approvalGraph());
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    const old = new Date(now() - 1_000).toISOString();
    for (const status of ["completed", "failed", "cancelled"] as const) {
      await deps.store.insert({ ...paused, id: `wfr_${status}`, status, updatedAt: old }, 0);
    }
    await deps.store.insert({ ...paused, id: "wfr_queued", status: "queued", updatedAt: old }, 0);

    expect(await deps.store.purgeFinished(now(), 2)).toBe(2);
    expect(await deps.store.purgeFinished(now(), 100)).toBe(1);
    expect(await deps.store.purgeFinished(now(), 100)).toBe(0);
    expect(await deps.store.get("wfr_queued")).not.toBeNull();
    expect(await deps.store.get(paused.id)).not.toBeNull();
  });
});

describe("run alerts", () => {
  it("names the approvers when a run stops on their step", async () => {
    const { deps, live, notifications } = harness(namedApprovalGraph());
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(notifications).toEqual([
      {
        kind: "workflow_run.approval_needed",
        spaceId: deps.spaceId,
        runId: paused.id,
        workflowNodeId: "nod_workflow",
        stepLabel: "Sales lead",
        approvers: ["lead@example.com", "ops@example.com"],
        startedBy: deps.actorId,
        actorId: deps.actorId,
      },
    ]);
  });

  it("leaves nobody out when the scheduler moved the run, since nobody is watching", async () => {
    const { deps, live, notifications } = harness(namedApprovalGraph());
    const paused = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    notifications.length = 0;
    await deps.store.save({
      ...paused,
      status: "queued",
      pause: null,
      cursorNodeId: "review",
      outputs: { trigger: paused.outputs.trigger as never },
    });
    await continueDueWorkflowRun({ ...deps, background: true }, paused.id);
    expect(notifications).toMatchObject([{ kind: "workflow_run.approval_needed", actorId: null }]);
  });

  it("reports a failure with its reason, and only then", async () => {
    const { deps, live, notifications } = harness(namedApprovalGraph());
    await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(notifications.some((event) => event.kind === "workflow_run.failed")).toBe(false);

    notifications.length = 0;
    deps.readRecord = async () => null;
    await expect(
      startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: "rec_missing" }),
    ).resolves.toMatchObject({ status: "failed" });
    expect(notifications).toMatchObject([
      {
        kind: "workflow_run.failed",
        error: expect.stringContaining("rec_missing"),
        actorId: deps.actorId,
      },
    ]);
  });
});

describe("update_record", () => {
  const updateGraph = (
    fields: Record<string, unknown>,
    errorPolicy: "stop" | "continue" = "stop",
  ) =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "score",
          kind: "action",
          label: "Score",
          position: at(1, 0),
          actionName: WORKFLOW_READ_RECORD_ACTION,
        },
        {
          id: "set",
          kind: "action",
          label: "Qualify",
          position: at(2, 0),
          actionName: WORKFLOW_UPDATE_RECORD_ACTION,
          fields,
        },
        { id: "end", kind: "end", label: "Done", position: at(3, 0), outcome: "done" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "score", outcome: "default" },
        { id: "e2", source: "score", target: "set", outcome: "success" },
        { id: "e3", source: "set", target: "end", outcome: "success" },
      ],
      settings: { errorPolicy },
    });

  it("sets plain values and later steps see the record as it is now", async () => {
    const { deps, live, updates } = harness(updateGraph({ status: "qualified", score: 91 }));
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("completed");
    expect(updates).toEqual([
      {
        recordId: "rec_lead",
        fields: { status: "qualified", score: 91 },
        message: 'Workflow step "Qualify"',
      },
    ]);
    // The step's own snapshot is the record after the change; the one before it is untouched.
    expect(run.outputs.set?.record?.fields.status).toBe("qualified");
    expect(run.outputs.set?.data).toMatchObject({
      executed: true,
      changed: { status: "qualified" },
    });
    expect(run.outputs.score?.record?.fields.status).toBe("new");
  });

  it("computes a value from an earlier step when the text starts with =", async () => {
    const { deps, live, updates } = harness(
      updateGraph({
        owner: "=steps.score.record.fields.owner",
        copy: "==literal",
        plain: "no formula",
        nested: { keep: ["as", "written"] },
      }),
    );
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("completed");
    expect(updates[0]?.fields).toEqual({
      owner: "ada",
      copy: "=literal",
      plain: "no formula",
      nested: { keep: ["as", "written"] },
    });
  });

  it("fails on a formula that finds nothing, rather than blanking the field", async () => {
    const { deps, live, updates } = harness(updateGraph({ status: "=steps.score.nothing.here" }));
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("failed");
    expect(run.error).toContain('"=steps.score.nothing.here" has no value yet');
    expect(updates).toEqual([]);
  });

  it("fails without a record, without fields, and when the change is refused", async () => {
    const noRecord = harness(updateGraph({ status: "x" }));
    const a = await startWorkflowRun(noRecord.deps, { nodeId: "nod_workflow" });
    expect(a.status).toBe("failed");

    const empty = harness(updateGraph({}));
    const b = await startWorkflowRun(empty.deps, {
      nodeId: "nod_workflow",
      recordId: empty.live.recordId,
    });
    expect(b.error).toContain("has no fields to set");

    const refused = harness(updateGraph({ status: "x" }));
    refused.setUpdateOutcome("error");
    const c = await startWorkflowRun(refused.deps, {
      nodeId: "nod_workflow",
      recordId: refused.live.recordId,
    });
    expect(c.status).toBe("failed");
    expect(c.error).toContain("Field is invalid: status");
    expect(refused.live.fields.status).toBe("new");
  });

  it("does not pretend a change that went to review was applied", async () => {
    const { deps, live, setUpdateOutcome } = harness(updateGraph({ status: "qualified" }));
    setUpdateOutcome("review");
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("crq_review");
    expect(run.error).toContain("The record is unchanged");
    expect(live.fields.status).toBe("new");
  });

  it("under 'continue', records the problem and takes the success path", async () => {
    const { deps, live, setUpdateOutcome } = harness(updateGraph({ status: "q" }, "continue"));
    setUpdateOutcome("review");
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("completed");
    expect(run.outputs.set?.data).toMatchObject({ executed: false, changeRequestId: "crq_review" });
  });
});

describe("create_record, delete_record, and writing to another record", () => {
  const graph = (
    nodes: Record<string, unknown>[],
    errorPolicy: "stop" | "continue" = "stop",
    ends = true,
  ) => {
    const all: ({ id: string } & Record<string, unknown>)[] = [
      { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
      ...nodes.map((node, index) => ({
        position: at(index + 1, 0),
        ...(node as { id: string } & Record<string, unknown>),
      })),
      ...(ends ? [{ id: "end", kind: "end", label: "Done", position: at(9, 0) }] : []),
    ];
    return parseWorkflowDocument({
      version: 2,
      nodes: all,
      edges: all.slice(1).map((node, index) => ({
        id: `e${index}`,
        source: all[index]?.id,
        target: node.id,
        outcome: index === 0 ? "default" : "success",
      })),
      settings: { errorPolicy },
    });
  };
  const createStep = {
    id: "create",
    kind: "action",
    label: "Add task",
    actionName: WORKFLOW_CREATE_RECORD_ACTION,
    baseId: "bas_tasks",
    fields: { title: "Call them", owner: "=steps.trigger.record.fields.owner" },
  };

  it("creates a record in the chosen Base, and later steps can use its id", async () => {
    const { deps, live, creates, updates } = harness(
      graph([
        createStep,
        {
          id: "touch",
          kind: "action",
          label: "Touch it",
          actionName: WORKFLOW_UPDATE_RECORD_ACTION,
          targetRecordId: "=steps.create.createdRecordId",
          fields: { status: "open" },
        },
      ]),
    );
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.error).toBeNull();
    expect(run.status).toBe("completed");
    expect(creates).toEqual([
      {
        baseId: "bas_tasks",
        fields: { title: "Call them", owner: "ada" },
        message: 'Workflow step "Add task"',
      },
    ]);
    expect(run.outputs.create?.record?.recordId).toBe("rec_new");
    expect(run.outputs.create?.data.createdRecordId).toBe("rec_new");
    // The formula pointed the update at the new record, not the run's own.
    expect(updates[0]?.recordId).toBe("rec_new");
    expect(live.fields.status).toBe("new");
  });

  it("needs a Base and fields to create, and needs no record on the run", async () => {
    const noBase = harness(graph([{ ...createStep, baseId: "" }]));
    expect((await startWorkflowRun(noBase.deps, { nodeId: "nod_workflow" })).error).toContain(
      "needs a Base",
    );
    const noFields = harness(graph([{ ...createStep, fields: {} }]));
    expect((await startWorkflowRun(noFields.deps, { nodeId: "nod_workflow" })).error).toContain(
      "has no fields",
    );
    const noRecord = harness(graph([{ ...createStep, fields: { title: "x" } }]));
    expect((await startWorkflowRun(noRecord.deps, { nodeId: "nod_workflow" })).status).toBe(
      "completed",
    );
  });

  it("says no record was created when the create went to review", async () => {
    const { deps, setUpdateOutcome } = harness(graph([{ ...createStep, fields: { title: "x" } }]));
    setUpdateOutcome("review");
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("crq_review");
    expect(run.error).toContain("No record was created");
  });

  const deleteStep = {
    id: "drop",
    kind: "action",
    label: "Drop it",
    actionName: WORKFLOW_DELETE_RECORD_ACTION,
  };

  it("deletes the run's own record, and later steps carry on without it", async () => {
    const { deps, live, deletes } = harness(
      graph([
        deleteStep,
        { id: "after", kind: "webhook", label: "Tell CRM", url: "https://x.test" },
      ]),
    );
    const payloads: unknown[] = [];
    deps.sendWebhook = async (call) => {
      payloads.push(call.body);
      return { ok: true, status: 200, body: null, durationMs: 1 };
    };
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.error).toBeNull();
    expect(run.status).toBe("completed");
    expect(deletes).toEqual(["rec_lead"]);
    expect(run.outputs.drop?.data).toMatchObject({ executed: true, deletedRecordId: "rec_lead" });
    expect(payloads[0]).toMatchObject({ record: null, recordId: "rec_lead" });
  });

  it("deletes another record by id or formula, and a read of the run's own record still works", async () => {
    const { deps, live, deletes } = harness(
      graph([{ ...deleteStep, targetRecordId: "=input.record.recordId" }]),
    );
    const byFormula = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });
    expect(byFormula.status).toBe("completed");
    expect(deletes).toEqual(["rec_lead"]);

    const other = harness(graph([{ ...deleteStep, targetRecordId: " rec_other " }]));
    const byId = await startWorkflowRun(other.deps, {
      nodeId: "nod_workflow",
      recordId: other.live.recordId,
    });
    expect(byId.status).toBe("completed");
    expect(other.deletes).toEqual(["rec_other"]);
    // Someone else's record went; this run's own record is still there for later steps.
    expect(byId.outputs.trigger?.record?.recordId).toBe("rec_lead");
  });

  it("fails clearly when a target formula gives no record, and touches nothing", async () => {
    const { deps, live, deletes } = harness(
      graph([{ ...deleteStep, targetRecordId: "=steps.nowhere.id" }]),
    );
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("failed");
    expect(run.error).toContain('"=steps.nowhere.id" did not give a record id');
    expect(deletes).toEqual([]);
  });

  it("does not claim a delete that went to review, and needs a record to delete", async () => {
    const review = harness(graph([deleteStep]));
    review.setUpdateOutcome("review");
    const sent = await startWorkflowRun(review.deps, {
      nodeId: "nod_workflow",
      recordId: review.live.recordId,
    });
    expect(sent.error).toContain("The record is unchanged");

    const none = harness(graph([deleteStep]));
    const bare = await startWorkflowRun(none.deps, { nodeId: "nod_workflow" });
    expect(bare.error).toContain("needs a record");
  });

  it("under 'continue', records a refused write and takes the success path", async () => {
    const { deps, live, setUpdateOutcome } = harness(graph([deleteStep], "continue"));
    setUpdateOutcome("error");
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(run.status).toBe("completed");
    expect(run.outputs.drop?.data).toMatchObject({ executed: false, error: "Already archived" });
  });
});

describe("agents", () => {
  const agent = (ceiling: "read" | "changeRequest" | "write" | "manage" | null = "write") => ({
    apiKeyId: "key_1",
    apiKeyName: "Sales bot",
    channel: "mcp",
    ceiling,
  });
  const approvalFor = (allowAgents: boolean, approver = "") =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "review",
          kind: "approval",
          label: "Sales lead",
          position: at(1, 0),
          approver,
          allowAgents,
        },
        { id: "ok", kind: "end", label: "OK", position: at(2, 0), outcome: "approved" },
        { id: "no", kind: "end", label: "No", position: at(2, 1), outcome: "rejected" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "review", outcome: "default" },
        { id: "e2", source: "review", target: "ok", outcome: "approved" },
        { id: "e3", source: "review", target: "no", outcome: "rejected" },
      ],
      settings: {},
    });

  it("records which key started a run, and still alerts its owner, who is not watching", async () => {
    const { deps, notifications } = harness(approvalFor(false));
    deps.agent = agent();
    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    expect(run.startedVia).toEqual({ apiKeyId: "key_1", apiKeyName: "Sales bot", channel: "mcp" });
    expect(run.startedBy).toBe(deps.actorId);
    expect(notifications).toMatchObject([{ kind: "workflow_run.approval_needed", actorId: null }]);
  });

  it("refuses an agent's decision on a step that has not allowed it, even for its owner", async () => {
    const { deps } = harness(approvalFor(false));
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    deps.agent = agent("manage");
    await expect(
      decideWorkflowRun(deps, { runId: paused.id, decision: "approved" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("takes a person's decision"),
    });
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).decidableRunIds).toEqual([]);
    expect((await getWorkflowRun(deps, paused.id)).status).toBe("waiting_approval");
  });

  it("lets a person decide the same step, and records no agent", async () => {
    const { deps } = harness(approvalFor(false));
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    const decided = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });
    expect(decided.status).toBe("completed");
    expect(decided.outputs.review?.data.decidedVia).toBeUndefined();
  });

  it("lets an agent decide once the step allows it, and says who pressed the button", async () => {
    const { deps } = harness(approvalFor(true));
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    deps.agent = agent();
    expect((await listWorkflowRuns(deps, { nodeId: "nod_workflow" })).decidableRunIds).toEqual([
      paused.id,
    ]);
    const decided = await decideWorkflowRun(deps, { runId: paused.id, decision: "rejected" });
    expect(decided.status).toBe("completed");
    expect(decided.outputs.review?.data).toMatchObject({
      decision: "rejected",
      decidedBy: deps.actorId,
      decidedVia: { apiKeyName: "Sales bot", channel: "mcp" },
    });
  });

  it("does not let a key below write decide, even a named approver's", async () => {
    for (const level of ["read", "changeRequest"] as const) {
      const { deps, setNamedApprover } = harness(approvalFor(true, "lead@example.com"));
      const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
      setNamedApprover(true);
      deps.agent = agent(level);
      await expect(
        decideWorkflowRun(deps, { runId: paused.id, decision: "approved" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(`(${level}) cannot decide`),
      });
    }
  });

  it("still holds an allowed agent to the step's approver rule", async () => {
    const { deps } = harness(approvalFor(true, "lead@example.com"));
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    deps.agent = agent();
    await expect(
      decideWorkflowRun(deps, { runId: paused.id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("treats a key with no level of its own as able to write", async () => {
    const { deps } = harness(approvalFor(true));
    const paused = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    deps.agent = agent(null);
    const decided = await decideWorkflowRun(deps, { runId: paused.id, decision: "approved" });
    expect(decided.status).toBe("completed");
  });
});
