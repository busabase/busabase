import { ORPCError } from "@orpc/server";
import { parseWorkflowDocument } from "busabase-contract/domains/rich-node/types";
import {
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DATA_FRESHNESS,
  WORKFLOW_DELETE_RECORD_ACTION,
  WORKFLOW_FIND_RECORDS_ACTION,
  WORKFLOW_MAX_QUEUED_RUNS,
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_SANDBOX_POLL_MS,
  WORKFLOW_SANDBOX_TIMEOUT_MS,
  WORKFLOW_UPDATE_RECORD_ACTION,
  type WorkflowRun,
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
  listWaitingWorkflowRuns,
  listWorkflowRuns,
  resumeElapsedWorkflowRuns,
  resumeWorkflowRun,
  retryWorkflowRun,
  startWorkflowRun,
  type WorkflowAccessLevel,
  type WorkflowFunctionCallResult,
  type WorkflowRuntimeDeps,
  type WorkflowSandboxCall,
  type WorkflowSandboxPoll,
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
  /** Workflows the caller cannot read at all, and the name each workflow shows in lists. */
  const hiddenWorkflows = new Set<string>();
  const workflowNames: Record<string, string> = {};
  const notifications: BusabaseNotificationEvent[] = [];
  const updates: { recordId: string; fields: Record<string, unknown>; message: string }[] = [];
  let updateOutcome: "merged" | "review" | "error" = "merged";
  const creates: { baseId: string; fields: Record<string, unknown>; message: string }[] = [];
  const deletes: string[] = [];
  /** What the next Function steps answer, in order, and how many ran. */
  const functionOutcomes: WorkflowFunctionCallResult[] = [];
  let functionCalls = 0;
  let recordGone = false;
  /** What a Find records step finds, and how many matched in all (past its limit too). */
  let found: LiveRecord[] = [];
  let foundTotal: number | null = null;
  const finds: { baseId: string; viewId: string | null; limit: number }[] = [];
  /** The fake sandbox: what was started, what each poll answers, what was removed. */
  const sandboxStarts: WorkflowSandboxCall[] = [];
  const sandboxStops: string[] = [];
  let sandboxAnswer: WorkflowSandboxPoll = { done: false };
  let sandboxRefusal: string | null = null;
  const deps: WorkflowRuntimeDeps = {
    spaceId: "spc_test",
    actorId: "usr_ada",
    store: createMemoryWorkflowRunStore(),
    now: () => now,
    createId: () => {
      nextId += 1;
      return `wfr_test_${nextId}`;
    },
    readRecord: async (recordId) => {
      const hit = found.find((record) => record.recordId === recordId);
      if (hit) return structuredClone(hit);
      return recordGone ? null : { ...live, fields: structuredClone(live.fields) };
    },
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
      if (grant === null || hiddenWorkflows.has(nodeId))
        throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });
      if (level === "write" && grant === "read") {
        throw new ORPCError("FORBIDDEN", { message: "Requires write access on this node" });
      }
      return nodeId;
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
    findRecords: async (baseId, viewId, limit) => {
      finds.push({ baseId, viewId, limit });
      return {
        records: found.slice(0, limit).map((record) => structuredClone(record)),
        total: foundTotal ?? found.length,
      };
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
    describeWorkflow: async (nodeId) => ({ name: workflowNames[nodeId] ?? "Lead handoff" }),
    executeFunction: async () => {
      functionCalls += 1;
      const next = functionOutcomes.shift();
      if (!next) throw new Error("executeFunction was not expected");
      return next;
    },
    sendWebhook: async () => {
      throw new Error("sendWebhook was not expected");
    },
    sandbox: {
      start: async (call) => {
        if (sandboxRefusal) throw new Error(sandboxRefusal);
        sandboxStarts.push(structuredClone(call));
        return { sandboxId: `sbx_${sandboxStarts.length}` };
      },
      poll: async () => structuredClone(sandboxAnswer),
      stop: async (sandboxId) => {
        sandboxStops.push(sandboxId);
      },
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
    hiddenWorkflows,
    workflowNames,
    notifications,
    updates,
    creates,
    deletes,
    functionOutcomes,
    functionCalls: () => functionCalls,
    finds,
    sandboxStarts,
    sandboxStops,
    answerSandbox: (answer: WorkflowSandboxPoll) => {
      sandboxAnswer = answer;
    },
    refuseSandbox: (message: string | null) => {
      sandboxRefusal = message;
    },
    setFound: (records: LiveRecord[], total?: number) => {
      found = records;
      foundTotal = total ?? null;
    },
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
  it("hands the step's signing secret to the sender and keeps it out of what the run stores", async () => {
    const graph = webhookGraph("https://hooks.example.com/enrich");
    const hook = graph.nodes.find((node) => node.id === "hook");
    if (hook?.kind === "webhook") hook.signingSecret = "whsec_never_stored_in_a_run_0123";
    const { deps, live } = harness(graph);
    const sent: Array<Parameters<WorkflowRuntimeDeps["sendWebhook"]>[0]> = [];
    deps.sendWebhook = async (call) => {
      sent.push(call);
      return { ok: true, status: 202, body: { accepted: true }, durationMs: 1 };
    };

    const finished = await startWorkflowRun(deps, {
      nodeId: "nod_workflow",
      recordId: live.recordId,
    });

    expect(sent[0]?.signingSecret).toBe("whsec_never_stored_in_a_run_0123");
    expect(JSON.stringify(finished)).not.toContain("whsec_never_stored_in_a_run_0123");
    expect(JSON.stringify(sent[0]?.body)).not.toContain("whsec_never_stored_in_a_run_0123");
  });

  it("sends no secret for a step that does not sign", async () => {
    const { deps, live } = harness(webhookGraph("https://hooks.example.com/enrich"));
    const sent: Array<Parameters<WorkflowRuntimeDeps["sendWebhook"]>[0]> = [];
    deps.sendWebhook = async (call) => {
      sent.push(call);
      return { ok: true, status: 202, body: { accepted: true }, durationMs: 1 };
    };
    await startWorkflowRun(deps, { nodeId: "nod_workflow", recordId: live.recordId });
    expect(sent[0]?.signingSecret).toBeNull();
  });

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

describe("find records", () => {
  const task = (n: number): LiveRecord => ({
    recordId: `rec_task_${n}`,
    baseId: "bas_tasks",
    headCommitId: `cmt_task_${n}`,
    fields: { status: "overdue", owner: `owner${n}` },
  });

  /** Trigger → Find records → (a second Find records, optionally) → Update record → End. */
  const findGraph = (
    find: Record<string, unknown>,
    options: { errorPolicy?: "stop" | "continue"; nestedForEach?: boolean } = {},
  ) =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Every morning", position: at(0, 0) },
        {
          id: "find",
          kind: "action",
          label: "Overdue tasks",
          position: at(1, 0),
          actionName: WORKFLOW_FIND_RECORDS_ACTION,
          baseId: "bas_tasks",
          ...find,
        },
        ...(options.nestedForEach
          ? [
              {
                id: "again",
                kind: "action",
                label: "Again",
                position: at(2, 1),
                actionName: WORKFLOW_FIND_RECORDS_ACTION,
                baseId: "bas_tasks",
                forEach: true,
              },
            ]
          : []),
        {
          id: "remind",
          kind: "action",
          label: "Mark reminded",
          position: at(2, 0),
          actionName: WORKFLOW_UPDATE_RECORD_ACTION,
          fields: { status: "reminded", note: "=steps.find.record.fields.owner" },
        },
        { id: "done", kind: "end", label: "Done", position: at(3, 0) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "find" },
        {
          id: "e2",
          source: "find",
          target: options.nestedForEach ? "again" : "remind",
          outcome: "success",
        },
        ...(options.nestedForEach
          ? [{ id: "e2b", source: "again", target: "remind", outcome: "success" }]
          : []),
        { id: "e3", source: "remind", target: "done", outcome: "success" },
      ],
      settings: { errorPolicy: options.errorPolicy ?? "stop" },
    });

  const queuedRuns = async (deps: WorkflowRuntimeDeps) =>
    (await deps.store.listDue(deps.now(), 1_000)).filter((run) => run.status === "queued");

  it("gives later steps the list, and says when the limit cut it", async () => {
    const graph = parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "find",
          kind: "action",
          label: "Overdue tasks",
          position: at(1, 0),
          actionName: WORKFLOW_FIND_RECORDS_ACTION,
          baseId: "bas_tasks",
          viewId: "viw_overdue",
          limit: 2,
        },
        {
          id: "check",
          kind: "condition",
          label: "Two?",
          position: at(2, 0),
          expression: "steps.find.count == 2 && steps.find.truncated == true",
        },
        { id: "yes", kind: "end", label: "Yes", position: at(3, 0), outcome: "yes" },
        { id: "no", kind: "end", label: "No", position: at(3, 1), outcome: "no" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "find" },
        { id: "e2", source: "find", target: "check", outcome: "success" },
        { id: "e3", source: "check", target: "yes", outcome: "true" },
        { id: "e4", source: "check", target: "no", outcome: "false" },
      ],
      settings: {},
    });
    const { deps, finds, setFound } = harness(graph);
    setFound([task(1), task(2), task(3)]);

    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(finds).toEqual([{ baseId: "bas_tasks", viewId: "viw_overdue", limit: 2 }]);
    expect(run.status).toBe("completed");
    expect(run.outputs.find?.data).toMatchObject({ count: 2, total: 3, truncated: true });
    expect(
      (run.outputs.find?.data.records as { recordId: string }[]).map((r) => r.recordId),
    ).toEqual(["rec_task_1", "rec_task_2"]);
    expect(run.outputs.yes).toBeDefined();
    expect(await queuedRuns(deps)).toEqual([]);
  });

  it("runs the next steps once per record, each run about its own record", async () => {
    const { deps, updates, setFound } = harness(findGraph({ forEach: true }));
    setFound([task(1), task(2), task(3)]);

    const parent = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(parent.status).toBe("completed");
    expect(parent.cursorNodeId).toBeNull();
    expect(parent.outputs.remind).toBeUndefined();
    const childRunIds = parent.outputs.find?.data.childRunIds as string[];
    expect(childRunIds).toHaveLength(3);
    expect(updates).toEqual([]);

    const children = await queuedRuns(deps);
    expect(children.map((run) => run.id).sort()).toEqual([...childRunIds].sort());
    for (const child of children) {
      expect(child).toMatchObject({
        status: "queued",
        cursorNodeId: "remind",
        previousNodeId: "find",
        startedBy: parent.startedBy,
        payload: { parentRunId: parent.id },
      });
      expect(child.outputs.find?.record?.recordId).toBe(child.recordId);
      expect(child.outputs.trigger).toEqual(parent.outputs.trigger);
    }

    for (const child of children) {
      const finished = await continueDueWorkflowRun(deps, child.id);
      expect(finished?.status).toBe("completed");
    }
    expect(updates.map((update) => update.recordId).sort()).toEqual([
      "rec_task_1",
      "rec_task_2",
      "rec_task_3",
    ]);
    // A formula reads the record this run is about.
    expect(updates.find((update) => update.recordId === "rec_task_2")?.fields).toEqual({
      status: "reminded",
      note: "owner2",
    });
  });

  it("starts nothing when more records match than the limit, even under error policy continue", async () => {
    for (const errorPolicy of ["stop", "continue"] as const) {
      const { deps, updates, setFound } = harness(
        findGraph({ forEach: true, limit: 3 }, { errorPolicy }),
      );
      setFound([task(1), task(2), task(3)], 5);

      const parent = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

      expect(parent.status).toBe("failed");
      expect(parent.error).toContain("found 5 records, more than its limit of 3");
      expect(await queuedRuns(deps)).toEqual([]);
      expect(updates).toEqual([]);
    }
  });

  it("does not repeat inside a run that is already one of a repeat", async () => {
    const { deps, updates, setFound } = harness(
      findGraph({ forEach: true }, { nestedForEach: true }),
    );
    setFound([task(1), task(2)]);
    await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    const children = await queuedRuns(deps);
    expect(children).toHaveLength(2);

    const child = await continueDueWorkflowRun(deps, children[0]?.id ?? "");

    expect(child?.status).toBe("failed");
    expect(child?.error).toContain("already one of those runs");
    expect(await queuedRuns(deps)).toHaveLength(1);
    expect(updates).toEqual([]);
  });

  it("starts no more while the workflow has a backlog of waiting runs", async () => {
    const { deps, setFound } = harness(findGraph({ forEach: true }));
    setFound([task(1)]);
    // The first run leaves one child waiting; fill the rest of the backlog.
    const template = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    for (let n = 1; n < WORKFLOW_MAX_QUEUED_RUNS; n += 1) {
      await deps.store.insert({ ...template, id: `wfr_backlog_${n}`, status: "queued" }, 0);
    }
    expect(await queuedRuns(deps)).toHaveLength(WORKFLOW_MAX_QUEUED_RUNS);

    const blocked = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(blocked.status).toBe("failed");
    expect(blocked.error).toContain(
      `${WORKFLOW_MAX_QUEUED_RUNS} runs of this workflow are still waiting`,
    );
    expect(await queuedRuns(deps)).toHaveLength(WORKFLOW_MAX_QUEUED_RUNS);
  });

  it("finishes with nothing to do when no record matches", async () => {
    const { deps, setFound } = harness(findGraph({ forEach: true }));
    setFound([]);

    const parent = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(parent.status).toBe("completed");
    expect(parent.outputs.find?.data).toMatchObject({ count: 0, childRunIds: [] });
    expect(await queuedRuns(deps)).toEqual([]);
  });

  it("fails a step with no Base, and says so", async () => {
    const { deps, finds } = harness(findGraph({ baseId: "", forEach: true }));

    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(run.status).toBe("failed");
    expect(run.error).toContain("needs a Base");
    expect(finds).toEqual([]);
  });
});

describe("runs waiting for the caller, across workflows", () => {
  const approvalGraph = (approver = "", allowAgents = false) =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "review",
          kind: "approval",
          label: "Sign off",
          position: at(1, 0),
          approver,
          allowAgents,
        },
        { id: "end", kind: "end", label: "End", position: at(2, 0) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "review" },
        { id: "e2", source: "review", target: "end", outcome: "approved" },
      ],
      settings: { concurrency: 20 },
    });

  /** Start a run and move it into another workflow of the space, as if it had been started there. */
  const startIn = async (
    h: ReturnType<typeof harness>,
    workflowNodeId: string,
    startedAt: string,
  ): Promise<WorkflowRun> => {
    const run = await startWorkflowRun(h.deps, { nodeId: "nod_workflow" });
    const moved = { ...run, workflowNodeId, startedAt, updatedAt: startedAt };
    await h.deps.store.save(moved);
    return moved;
  };

  it("lists each run the caller may decide, newest first, with its workflow and step", async () => {
    const h = harness(approvalGraph());
    h.workflowNames.nod_sales = "Sales handoff";
    h.workflowNames.nod_hiring = "Hiring offer";
    const older = await startIn(h, "nod_sales", "2026-10-29T08:00:00.000Z");
    const newer = await startIn(h, "nod_hiring", "2026-10-29T09:00:00.000Z");

    const waiting = await listWaitingWorkflowRuns(h.deps, {});

    expect(waiting.items.map((item) => item.run.id)).toEqual([newer.id, older.id]);
    expect(waiting.items[0]).toMatchObject({ workflowName: "Hiring offer", stepLabel: "Sign off" });
    expect(waiting.items[1]).toMatchObject({
      workflowName: "Sales handoff",
      stepLabel: "Sign off",
    });
    expect(waiting.actorNames).toEqual({ usr_ada: "Name of usr_ada" });
  });

  it("orders runs across workflows by recency, not workflow by workflow", async () => {
    // The store hands runs back newest first, but the answer is built one
    // workflow at a time: without a final sort, every run of the workflow that
    // happens to come first would be listed before another workflow's newer one.
    const h = harness(approvalGraph(""));
    const oldest = await startIn(h, "nod_sales", "2026-10-01T08:00:00.000Z");
    const middle = await startIn(h, "nod_hiring", "2026-10-03T08:00:00.000Z");
    const newest = await startIn(h, "nod_sales", "2026-10-05T08:00:00.000Z");

    const waiting = await listWaitingWorkflowRuns(h.deps, {});

    expect(waiting.items.map((item) => item.run.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it("leaves out runs that are not waiting on an approval", async () => {
    const h = harness(freshnessGraph());
    const paused = await startWorkflowRun(h.deps, {
      nodeId: "nod_workflow",
      recordId: h.live.recordId,
    });
    expect(paused.status).toBe("waiting");

    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toEqual([]);
  });

  it("lists a named step only for a person it names, even one who can edit the workflow", async () => {
    const h = harness(approvalGraph("lead@example.com"));
    await startIn(h, "nod_sales", "2026-10-29T08:00:00.000Z");
    expect(h.deps.actorId).toBe("usr_ada");

    // An editor who is not named: nothing to decide.
    h.setNamedApprover(false);
    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toEqual([]);
    // The named approver sees it, though they can only read the workflow.
    h.setNamedApprover(true);
    h.setGrant("read");
    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toHaveLength(1);
  });

  it("lists a step that names nobody for anyone who can edit, and not for a reader", async () => {
    const h = harness(approvalGraph(""));
    await startIn(h, "nod_sales", "2026-10-29T08:00:00.000Z");

    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toHaveLength(1);
    h.setGrant("read");
    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toEqual([]);
  });

  it("never shows a run from a workflow the caller cannot read", async () => {
    const h = harness(approvalGraph(""));
    h.workflowNames.nod_secret = "Board matters";
    await startIn(h, "nod_secret", "2026-10-29T10:00:00.000Z");
    await startIn(h, "nod_sales", "2026-10-29T08:00:00.000Z");
    h.hiddenWorkflows.add("nod_secret");

    const waiting = await listWaitingWorkflowRuns(h.deps, {});

    expect(waiting.items.map((item) => item.workflowName)).toEqual(["Lead handoff"]);
    expect(JSON.stringify(waiting)).not.toContain("Board matters");
  });

  it("shows an agent only the steps that let agents decide", async () => {
    const closed = harness(approvalGraph("", false));
    await startIn(closed, "nod_sales", "2026-10-29T08:00:00.000Z");
    closed.deps.agent = { apiKeyId: "key_1", apiKeyName: "Bot", channel: "mcp", ceiling: "write" };
    expect((await listWaitingWorkflowRuns(closed.deps, {})).items).toEqual([]);

    const open = harness(approvalGraph("", true));
    await startIn(open, "nod_sales", "2026-10-29T08:00:00.000Z");
    open.deps.agent = { apiKeyId: "key_1", apiKeyName: "Bot", channel: "mcp", ceiling: "write" };
    expect((await listWaitingWorkflowRuns(open.deps, {})).items).toHaveLength(1);
  });

  it("keeps to the limit, newest first", async () => {
    const h = harness(approvalGraph(""));
    for (let day = 1; day <= 5; day += 1) {
      await startIn(h, `nod_w${day}`, `2026-10-0${day}T08:00:00.000Z`);
    }

    const waiting = await listWaitingWorkflowRuns(h.deps, { limit: 2 });

    expect(waiting.items.map((item) => item.run.startedAt.slice(0, 10))).toEqual([
      "2026-10-05",
      "2026-10-04",
    ]);
  });
});

describe("retry from the failed step", () => {
  const ok = (result: unknown): WorkflowFunctionCallResult => ({
    ok: true,
    ruleId: "",
    functionName: "",
    result,
    logs: "",
  });
  const down: WorkflowFunctionCallResult = { ok: false, message: "partner is down" };

  /** Trigger → create a record → call the partner (a Function step) → End. */
  const partnerGraph = (concurrency = 1) =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "log",
          kind: "action",
          label: "Log the order",
          position: at(1, 0),
          actionName: WORKFLOW_CREATE_RECORD_ACTION,
          baseId: "bas_log",
          fields: { title: "order" },
        },
        {
          id: "partner",
          kind: "function",
          label: "Call the partner",
          position: at(2, 0),
          code: "return 1",
        },
        { id: "end", kind: "end", label: "End", position: at(3, 0) },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "log" },
        { id: "e2", source: "log", target: "partner", outcome: "success" },
        { id: "e3", source: "partner", target: "end", outcome: "success" },
      ],
      settings: { concurrency },
    });

  const failedAtPartner = async (graph = partnerGraph()) => {
    const h = harness(graph);
    h.functionOutcomes.push(down);
    const failed = await startWorkflowRun(h.deps, {
      nodeId: "nod_workflow",
      payload: { order: 7 },
    });
    expect(failed.status).toBe("failed");
    expect(failed.cursorNodeId).toBe("partner");
    return { ...h, failed };
  };

  it("runs again from the step that failed, and not the steps before it", async () => {
    const { deps, failed, creates, functionOutcomes, functionCalls } = await failedAtPartner();
    expect(creates).toHaveLength(1);
    functionOutcomes.push(ok({ accepted: true }));

    const retried = await retryWorkflowRun(deps, { runId: failed.id });

    expect(retried.status).toBe("completed");
    expect(retried.id).not.toBe(failed.id);
    expect(retried.payload).toMatchObject({ order: 7, retryOf: failed.id });
    // The step before it did not run again, and its output is the failed run's, unchanged.
    expect(creates).toHaveLength(1);
    expect(retried.outputs.log).toEqual(failed.outputs.log);
    expect(retried.outputs.trigger).toEqual(failed.outputs.trigger);
    expect(retried.outputs.partner?.data).toMatchObject({ accepted: true, executed: true });
    expect(functionCalls()).toBe(2);
    // The failed run is left as it was, plus a pointer to the retry.
    const after = await deps.store.get(failed.id);
    expect(after).toMatchObject({ status: "failed", error: failed.error });
    expect(after?.payload.retriedAs).toBe(retried.id);
  });

  it("acts as whoever retries, not whoever started the failed run", async () => {
    const { deps, failed, functionOutcomes } = await failedAtPartner();
    functionOutcomes.push(ok(1));
    deps.actorId = "usr_bea";

    const retried = await retryWorkflowRun(deps, { runId: failed.id });

    expect(retried.startedBy).toBe("usr_bea");
    expect(failed.startedBy).toBe("usr_ada");
  });

  it("retries a run once: a second try says so and sends nothing again", async () => {
    const { deps, failed, functionOutcomes, functionCalls } = await failedAtPartner();
    functionOutcomes.push(ok(1), ok(2));
    const retried = await retryWorkflowRun(deps, { runId: failed.id });

    await expect(retryWorkflowRun(deps, { runId: failed.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: `This run was already retried as ${retried.id}`,
    });
    expect(functionCalls()).toBe(2);
  });

  it("lets a retry that fails again be retried in turn", async () => {
    const { deps, failed, functionOutcomes } = await failedAtPartner();
    functionOutcomes.push(down, ok(1));
    const second = await retryWorkflowRun(deps, { runId: failed.id });
    expect(second.status).toBe("failed");
    expect(second.payload.retryOf).toBe(failed.id);

    const third = await retryWorkflowRun(deps, { runId: second.id });

    expect(third.status).toBe("completed");
    expect(third.payload.retryOf).toBe(second.id);
  });

  it("refuses a run that has not failed", async () => {
    const h = harness(partnerGraph());
    h.functionOutcomes.push(ok(1));
    const done = await startWorkflowRun(h.deps, { nodeId: "nod_workflow" });
    expect(done.status).toBe("completed");

    await expect(retryWorkflowRun(h.deps, { runId: done.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Only a failed run can be retried",
    });
  });

  it("refuses when the step it stopped on is gone from the workflow", async () => {
    const { deps, failed, replaceDocument } = await failedAtPartner();
    replaceDocument(
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
          { id: "end", kind: "end", label: "End", position: at(1, 0) },
        ],
        edges: [{ id: "e1", source: "trigger", target: "end" }],
        settings: {},
      }),
    );

    await expect(retryWorkflowRun(deps, { runId: failed.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining('Step "partner" is no longer in this workflow'),
    });
    const listed = await listWorkflowRuns(deps, { nodeId: "nod_workflow" });
    expect(listed.retryableRunIds).toEqual([]);
  });

  it("runs the step with its current settings, so a fix to the step takes effect", async () => {
    const { deps, failed, functionOutcomes, replaceDocument, functionCalls } =
      await failedAtPartner();
    const fixed = partnerGraph();
    const partner = fixed.nodes.find((node) => node.id === "partner");
    if (partner?.kind === "function") partner.code = "return 2";
    replaceDocument(fixed);
    functionOutcomes.push(ok(2));

    const retried = await retryWorkflowRun(deps, { runId: failed.id });

    expect(retried.status).toBe("completed");
    expect(functionCalls()).toBe(2);
  });

  it("refuses a run that failed after its step finished, where retrying would only fail the same way", async () => {
    const h = harness(
      parseWorkflowDocument({
        version: 2,
        nodes: [
          { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
          {
            id: "check",
            kind: "condition",
            label: "Always true",
            position: at(1, 0),
            expression: "true == true",
          },
          { id: "end", kind: "end", label: "End", position: at(2, 0) },
        ],
        // Only a `false` branch exists, so the true answer has nowhere to go.
        edges: [
          { id: "e1", source: "trigger", target: "check" },
          { id: "e2", source: "check", target: "end", outcome: "false" },
        ],
        settings: {},
      }),
    );
    const failed = await startWorkflowRun(h.deps, { nodeId: "nod_workflow" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("No branch");

    await expect(retryWorkflowRun(h.deps, { runId: failed.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This run did not stop on a step that can run again",
    });
  });

  it("needs write on the workflow", async () => {
    const { deps, failed, setGrant, functionCalls } = await failedAtPartner();
    setGrant("read");

    await expect(retryWorkflowRun(deps, { runId: failed.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(functionCalls()).toBe(1);
  });

  it("waits its turn when the workflow is at its concurrency, keeping the earlier steps", async () => {
    const { deps, failed, creates, functionOutcomes } = await failedAtPartner();
    // Another run of the workflow is executing a step right now.
    await deps.store.insert({ ...failed, id: "wfr_busy", status: "running", error: null }, 0);
    functionOutcomes.push(ok(1));

    const retried = await retryWorkflowRun(deps, { runId: failed.id });

    expect(retried.status).toBe("queued");
    expect(retried.cursorNodeId).toBe("partner");
    expect(retried.outputs.log).toEqual(failed.outputs.log);
    expect(creates).toHaveLength(1);

    await deps.store.save({ ...(await deps.store.get("wfr_busy")), status: "cancelled" } as never);
    const started = await continueDueWorkflowRun(deps, retried.id);
    expect(started?.status).toBe("completed");
    expect(creates).toHaveLength(1);
  });

  it("keeps retry and approval permissions separate when both kinds of run are listed", async () => {
    const graph = partnerGraph(5);
    graph.nodes.push({
      id: "review",
      kind: "approval",
      label: "Sign off",
      description: "",
      position: at(3, 0),
      approver: "lead@example.com",
      allowAgents: false,
    });
    graph.edges = [
      ...graph.edges.filter((edge) => edge.target !== "end"),
      { id: "review-in", source: "partner", target: "review", label: "", outcome: "success" },
      { id: "review-out", source: "review", target: "end", label: "", outcome: "approved" },
    ];
    const h = await failedAtPartner(graph);
    h.functionOutcomes.push(ok(1));
    const pending = await startWorkflowRun(h.deps, { nodeId: "nod_workflow" });
    expect(pending.status).toBe("waiting_approval");

    const list = () => listWorkflowRuns(h.deps, { nodeId: "nod_workflow" });
    const forEditor = await list();
    expect(forEditor.retryableRunIds).toEqual([h.failed.id]);
    expect(forEditor.decidableRunIds).toEqual([]);
    expect((await listWaitingWorkflowRuns(h.deps, {})).items).toEqual([]);

    h.setNamedApprover(true);
    const forNamedEditor = await list();
    expect(forNamedEditor.retryableRunIds).toEqual([h.failed.id]);
    expect(forNamedEditor.decidableRunIds).toEqual([pending.id]);

    h.setGrant("read");
    const forNamedReader = await list();
    expect(forNamedReader.retryableRunIds).toEqual([]);
    expect(forNamedReader.decidableRunIds).toEqual([pending.id]);
    expect((await listWaitingWorkflowRuns(h.deps, {})).items.map((item) => item.run.id)).toEqual([
      pending.id,
    ]);
  });

  it("marks only runs that can run again as retryable in the list", async () => {
    const { deps, failed, functionOutcomes, setGrant } = await failedAtPartner();
    let listed = await listWorkflowRuns(deps, { nodeId: "nod_workflow" });
    expect(listed.retryableRunIds).toEqual([failed.id]);

    setGrant("read");
    listed = await listWorkflowRuns(deps, { nodeId: "nod_workflow" });
    expect(listed.retryableRunIds).toEqual([]);

    setGrant("write");
    functionOutcomes.push(ok(1));
    await retryWorkflowRun(deps, { runId: failed.id });
    listed = await listWorkflowRuns(deps, { nodeId: "nod_workflow" });
    expect(listed.retryableRunIds).toEqual([]);
  });
});

describe("code in a sandbox", () => {
  /** Trigger → Function in a sandbox → Condition on what it returned → End. */
  const sandboxGraph = (errorPolicy: "stop" | "continue" = "stop") =>
    parseWorkflowDocument({
      version: 2,
      nodes: [
        { id: "trigger", kind: "trigger", label: "Start", position: at(0, 0) },
        {
          id: "decrypt",
          kind: "function",
          label: "Decrypt",
          position: at(1, 0),
          code: "import json\nreturn {'text': 'hi'}",
          runIn: "sandbox",
          language: "python",
          packages: "pycryptodome",
        },
        {
          id: "check",
          kind: "condition",
          label: "Got text?",
          position: at(2, 0),
          expression: 'steps.decrypt.text == "hi"',
        },
        { id: "yes", kind: "end", label: "Yes", position: at(3, 0), outcome: "yes" },
        { id: "no", kind: "end", label: "No", position: at(3, 1), outcome: "no" },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "decrypt" },
        { id: "e2", source: "decrypt", target: "check", outcome: "success" },
        { id: "e3", source: "check", target: "yes", outcome: "true" },
        { id: "e4", source: "check", target: "no", outcome: "false" },
      ],
      settings: { errorPolicy },
    });

  it("starts the code on a machine and waits for it, without holding the request", async () => {
    const { deps, sandboxStarts } = harness(sandboxGraph());

    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow", payload: { body: "x" } });

    expect(run.status).toBe("waiting");
    expect(run.pause).toMatchObject({
      kind: "sandbox",
      nodeId: "decrypt",
      sandboxId: "sbx_1",
      resumeAt: new Date(deps.now() + WORKFLOW_SANDBOX_POLL_MS).toISOString(),
    });
    expect(sandboxStarts).toHaveLength(1);
    expect(sandboxStarts[0]).toMatchObject({
      stepId: "decrypt",
      language: "python",
      packages: "pycryptodome",
      timeoutMs: WORKFLOW_SANDBOX_TIMEOUT_MS,
      input: { payload: { body: "x" } },
    });
  });

  it("is picked up by the scheduler once its next check is due, like a Wait", async () => {
    const { deps, now } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect((await deps.store.listDue(now(), 10)).map((run) => run.id)).toEqual([]);
    expect(
      (await deps.store.listDue(now() + WORKFLOW_SANDBOX_POLL_MS, 10)).map((run) => run.id),
    ).toEqual([started.id]);
  });

  it("looks again while the code runs, then carries on with what it returned", async () => {
    const { deps, sandboxStops, answerSandbox, setNow, now } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    // Not yet due: the scheduler leaves it alone.
    expect(await continueDueWorkflowRun(deps, started.id)).toBeNull();

    setNow(now() + WORKFLOW_SANDBOX_POLL_MS);
    const still = await continueDueWorkflowRun(deps, started.id);
    expect(still?.status).toBe("waiting");
    expect(Date.parse(still?.pause?.resumeAt ?? "")).toBe(now() + WORKFLOW_SANDBOX_POLL_MS);
    expect(sandboxStops).toEqual([]);

    answerSandbox({ done: true, ok: true, result: { text: "hi" }, logs: "decrypted" });
    setNow(now() + WORKFLOW_SANDBOX_POLL_MS);
    const done = await continueDueWorkflowRun(deps, started.id);

    expect(done?.status).toBe("completed");
    expect(done?.outputs.decrypt?.data).toMatchObject({
      text: "hi",
      result: { text: "hi" },
      logs: "decrypted",
      runIn: "sandbox",
      executed: true,
    });
    expect(done?.outputs.yes).toBeDefined();
    expect(sandboxStops).toEqual(["sbx_1"]);
  });

  it("fails the run with the code's own error, and removes the machine", async () => {
    const { deps, sandboxStops, answerSandbox, setNow, now } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    answerSandbox({ done: true, ok: false, message: "ValueError: bad padding", logs: "" });
    setNow(now() + WORKFLOW_SANDBOX_POLL_MS);

    const failed = await continueDueWorkflowRun(deps, started.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe('Function step "Decrypt" (decrypt) failed: ValueError: bad padding');
    expect(sandboxStops).toEqual(["sbx_1"]);
  });

  it("under error policy continue, records the error and takes the success branch", async () => {
    const { deps, answerSandbox, setNow, now } = harness(sandboxGraph("continue"));
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    answerSandbox({ done: true, ok: false, message: "boom", logs: "partial" });
    setNow(now() + WORKFLOW_SANDBOX_POLL_MS);

    const done = await continueDueWorkflowRun(deps, started.id);

    expect(done?.status).toBe("completed");
    expect(done?.outputs.decrypt?.data).toMatchObject({ error: "boom", executed: false });
    expect(done?.outputs.no).toBeDefined();
  });

  it("stops code that runs past its deadline", async () => {
    const { deps, sandboxStops, setNow, now } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    setNow(Date.parse(started.pause?.deadlineAt ?? "") + 1);

    const failed = await continueDueWorkflowRun(deps, started.id);

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain(
      `did not finish within ${WORKFLOW_SANDBOX_TIMEOUT_MS / 60_000} minutes`,
    );
    expect(sandboxStops).toEqual(["sbx_1"]);
    expect(now()).toBeGreaterThan(Date.parse(started.startedAt));
  });

  it("removes the machine when someone cancels the run", async () => {
    const { deps, sandboxStops } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    const cancelled = await cancelWorkflowRun(deps, { runId: started.id });

    expect(cancelled.status).toBe("cancelled");
    expect(sandboxStops).toEqual(["sbx_1"]);
  });

  it("fails the step, provisioning nothing, when the space may not have a sandbox", async () => {
    const { deps, refuseSandbox, sandboxStarts } = harness(sandboxGraph());
    refuseSandbox("Running code in a sandbox needs the Plus plan.");

    const run = await startWorkflowRun(deps, { nodeId: "nod_workflow" });

    expect(run.status).toBe("failed");
    expect(run.error).toBe(
      'Function step "Decrypt" (decrypt) failed: Running code in a sandbox needs the Plus plan.',
    );
    expect(sandboxStarts).toEqual([]);
  });

  it("is not hurried by resume-elapsed, which only continues Waits", async () => {
    const { deps, sandboxStops, setNow, now } = harness(sandboxGraph());
    const started = await startWorkflowRun(deps, { nodeId: "nod_workflow" });
    setNow(now() + WORKFLOW_SANDBOX_POLL_MS * 2);

    const resumed = await resumeElapsedWorkflowRuns(deps);

    expect(resumed).toEqual({ runs: [], failed: [] });
    expect((await deps.store.get(started.id))?.status).toBe("waiting");
    expect(sandboxStops).toEqual([]);
  });
});
