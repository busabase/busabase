import { ORPCError } from "@orpc/server";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import type {
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "busabase-contract/domains/rich-node/types";
import {
  type CancelQueuedWorkflowRunsInput,
  type CancelQueuedWorkflowRunsOutput,
  type CancelWorkflowRunInput,
  type DecideWorkflowRunInput,
  type ListWaitingWorkflowRunsInput,
  type ListWaitingWorkflowRunsOutput,
  type ListWorkflowRunsInput,
  type ListWorkflowRunsOutput,
  parseWorkflowApprovers,
  type ResumeElapsedWorkflowRunsOutput,
  type ResumeWorkflowRunInput,
  type RetryWorkflowRunInput,
  type StartWorkflowRunInput,
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DATA_FRESHNESS,
  WORKFLOW_DELETE_RECORD_ACTION,
  WORKFLOW_FIND_RECORDS_ACTION,
  WORKFLOW_FIND_RECORDS_DEFAULT_LIMIT,
  WORKFLOW_FIND_RECORDS_MAX,
  WORKFLOW_MAX_QUEUED_RUNS,
  WORKFLOW_READ_RECORD_ACTION,
  WORKFLOW_SANDBOX_POLL_MS,
  WORKFLOW_SANDBOX_TIMEOUT_MS,
  WORKFLOW_UPDATE_RECORD_ACTION,
  type WorkflowRecordSnapshot,
  type WorkflowRun,
  WorkflowRunSchema,
  type WorkflowStepOutput,
} from "busabase-contract/domains/workflow/run";
import type { BusabaseNotificationEvent } from "../../../context";
import { type ExpressionScope, evaluateCondition, evaluateValue } from "./expression";
import {
  FINISHED_WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_LEASE_MS,
  type WorkflowRunPosition,
  type WorkflowRunStore,
} from "./run-store";

/**
 * Walks a stored workflow graph until it pauses, finishes, or fails.
 *
 * Data freshness is mixed on purpose:
 * - A step's output is frozen when that step finishes. Later steps read that
 *   copy, even if the underlying record changes during a Wait or approval.
 *   Function and webhook results are snapshots too.
 * - `read_record` is the exception. It loads the bound record's current head
 *   at the moment it runs. Place it after a pause to branch on current data.
 * - Resume re-reads the graph for steps that have not run yet. Outputs already
 *   stored are not recomputed.
 *
 * Permissions: reading a run needs `read` on the workflow node; starting,
 * continuing, or deciding one needs `write`, because a run executes function
 * and webhook steps that reach outside Busabase. Whoever drives a step acts
 * with their own access — a person in a request, or the run's `startedBy`
 * when the scheduler continues it.
 *
 * With error policy `stop` (the default) a failed function or webhook step
 * fails the run. With `continue` the failure is recorded on the step and the
 * success branch is followed. Action names the runtime does not know are
 * recorded and skipped.
 *
 * A `find_records` step with `forEach` ends its run and queues one run per
 * record found. Each starts at the step after it, about that record, with a
 * copy of the steps before; `payload.parentRunId` names the run it came from.
 */

/**
 * What a function step asks the host to run: the step's own `code`, or else a
 * saved rule by id or name. The walker passes code through and never runs it.
 */
export interface WorkflowFunctionCall {
  /** Code written in the step. When not blank it runs instead of a saved rule. */
  code: string;
  webhookRuleId: string;
  functionName: string;
  recordBaseId: string | null;
  /** Workflow `settings.timeoutMs`. The rule's own timeout is a tighter cap. */
  timeoutMs: number;
  input: WorkflowStepInput;
}

/**
 * The run's data as a step sees it. Functions receive this as `input`, and a
 * webhook step sends it as its JSON body.
 *
 * `event`, `recordId`, `baseId`, and `fields` mirror the shape a record webhook
 * rule receives, so one function body can serve both a webhook rule and a
 * workflow step.
 */
export interface WorkflowStepInput {
  event: "workflow.step";
  runId: string;
  workflowNodeId: string;
  stepId: string;
  payload: Record<string, unknown>;
  record: WorkflowRecordSnapshot | null;
  recordId: string | null;
  baseId: string | null;
  fields: Record<string, unknown> | null;
  steps: Record<string, Record<string, unknown>>;
  /** Previous step, or null on the first step. Conditions call this `input`. */
  previous: Record<string, unknown> | null;
}

export type WorkflowFunctionCallResult =
  | {
      ok: true;
      ruleId: string;
      functionName: string;
      result: unknown;
      logs: string;
    }
  | {
      ok: false;
      message: string;
      ruleId?: string;
      functionName?: string;
      logs?: string;
    };

export interface WorkflowWebhookCall {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  timeoutMs: number;
  body: WorkflowStepInput;
  /** The step's own headers, such as `Authorization`. Never copied into the run's outputs. */
  headers: readonly { name: string; value: string }[];
  /** Signs the request when set (`X-Busabase-Signature`). Never copied into the run's outputs. */
  signingSecret: string | null;
}

/** A Function step's code to run on a sandbox machine instead of in the app. */
export interface WorkflowSandboxCall {
  stepId: string;
  code: string;
  language: "javascript" | "python";
  /** As the step wrote it: package specs separated by spaces or commas. */
  packages: string;
  input: WorkflowStepInput;
  /** How long the code itself may run once packages are installed. */
  timeoutMs: number;
}

/** Where sandboxed code is: still going, or finished with what it returned or why it failed. */
export type WorkflowSandboxPoll =
  | { done: false }
  | { done: true; ok: true; result: unknown; logs: string }
  | { done: true; ok: false; message: string; logs: string };

export type WorkflowWebhookCallResult =
  | { ok: true; status: number; body: unknown; durationMs: number }
  | { ok: false; message: string; status: number | null; body: unknown; durationMs: number };

export type WorkflowAccessLevel = "read" | "write";

export const WORKFLOW_MAX_STEPS = 64;

const UNIT_MS = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
} as const;

export interface WorkflowAgentCaller {
  apiKeyId: string | null;
  apiKeyName: string | null;
  channel: string | null;
  /** The key's level. Null means the key has no limit of its own. */
  ceiling: ApiKeyPermissionLevel | null;
}

/** Whoever is watching this call happen. An agent's owner is not, so they still get alerts. */
const personAtKeyboard = (deps: WorkflowRuntimeDeps): string | null =>
  deps.background || deps.agent ? null : deps.actorId;

export interface WorkflowRuntimeDeps {
  spaceId: string;
  /** Who is driving this call. Becomes `startedBy` on a run it starts. */
  actorId: string;
  store: WorkflowRunStore;
  now: () => number;
  readRecord: (recordId: string) => Promise<WorkflowRecordSnapshot | null>;
  /**
   * Check the caller's access to a workflow node and return its canonical id.
   * Throws (NOT_FOUND / FORBIDDEN / BAD_REQUEST) when the caller may not.
   */
  authorizeWorkflow: (nodeId: string, level: WorkflowAccessLevel) => Promise<string>;
  /** Non-throwing: may the caller start, continue, or decide runs (write)? */
  canDriveWorkflow: (nodeId: string) => Promise<boolean>;
  /**
   * Non-throwing: may the caller decide an approval step that names these
   * approvers (already parsed, lower-case)? Called only for a non-empty list:
   * true for a named approver or a space manager.
   */
  isNamedApprover: (approvers: readonly string[]) => Promise<boolean>;
  /** The saved graph. Called only after `authorizeWorkflow`. */
  loadDocument: (nodeId: string) => Promise<WorkflowDocument>;
  /** A workflow's name, for lists that span workflows. Called only after `authorizeWorkflow`. */
  describeWorkflow: (nodeId: string) => Promise<{ name: string }>;
  executeFunction: (call: WorkflowFunctionCall) => Promise<WorkflowFunctionCallResult>;
  sendWebhook: (call: WorkflowWebhookCall) => Promise<WorkflowWebhookCallResult>;
  /**
   * Code on a sandbox machine. `start` provisions and starts it and returns at
   * once (it throws when this space cannot have one); the run then waits and
   * the scheduler calls `poll` until the code is done; `stop` removes the
   * machine and never throws.
   */
  sandbox: {
    start: (call: WorkflowSandboxCall) => Promise<{ sandboxId: string }>;
    poll: (sandboxId: string) => Promise<WorkflowSandboxPoll>;
    stop: (sandboxId: string) => Promise<void>;
  };
  createId: () => string;
  /**
   * Set fields on one record as the acting person. `merged: false` means the
   * change went to review instead of applying, because they cannot edit the
   * Base directly. Throws when the change is invalid or not allowed.
   */
  updateRecord: (
    recordId: string,
    fields: Record<string, unknown>,
    message: string,
  ) => Promise<
    { merged: true; record: WorkflowRecordSnapshot } | { merged: false; changeRequestId: string }
  >;
  /** Add a record to a Base as the acting person. Same outcomes as `updateRecord`. */
  createRecord: (
    baseId: string,
    fields: Record<string, unknown>,
    message: string,
  ) => Promise<
    { merged: true; record: WorkflowRecordSnapshot } | { merged: false; changeRequestId: string }
  >;
  /** Move a record to its Base's trash as the acting person. Same rules as `updateRecord`. */
  deleteRecord: (
    recordId: string,
    message: string,
  ) => Promise<{ merged: true } | { merged: false; changeRequestId: string }>;
  /**
   * Up to `limit` records of a Base the acting person can see: those a View
   * shows, in its order, or else every record, newest first. `total` counts
   * every match, past the limit too.
   */
  findRecords: (
    baseId: string,
    viewId: string | null,
    limit: number,
  ) => Promise<{ records: WorkflowRecordSnapshot[]; total: number }>;
  /** Display names for user ids, as far as the host knows them. */
  resolveActorNames: (actorIds: readonly string[]) => Promise<Record<string, string>>;
  /** Tell people about something that happened to a run. Never throws. */
  notify: (event: BusabaseNotificationEvent) => Promise<void>;
  /** The scheduler is moving the run: nobody is watching, so nobody is left out of its alerts. */
  background: boolean;
  /** Set when an agent is calling rather than a person in the app. */
  agent: WorkflowAgentCaller | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

const badRequest = (message: string): ORPCError<string, unknown> =>
  new ORPCError("BAD_REQUEST", { message });

const notFound = (message: string): ORPCError<string, unknown> =>
  new ORPCError("NOT_FOUND", { message });

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const publish = (run: WorkflowRun): WorkflowRun => WorkflowRunSchema.parse(structuredClone(run));

const stepView = (output: WorkflowStepOutput): Record<string, unknown> => ({
  ...output.data,
  kind: output.kind,
  capturedAt: output.capturedAt,
  record: output.record,
});

const emptyOutput = (): WorkflowStepOutput => ({
  kind: "missing",
  capturedAt: "",
  record: null,
  data: {},
});

const scopeFor = (run: WorkflowRun): ExpressionScope => ({
  input: run.previousNodeId ? stepView(run.outputs[run.previousNodeId] ?? emptyOutput()) : {},
  steps: Object.fromEntries(
    Object.entries(run.outputs).map(([id, output]) => [id, stepView(output)]),
  ),
});

const outgoing = (document: WorkflowDocument, nodeId: string): WorkflowEdge[] =>
  document.edges.filter((edge) => edge.source === nodeId);

const pickEdge = (
  node: WorkflowNode,
  edges: WorkflowEdge[],
  branch: string,
): WorkflowEdge | null => {
  const exact = edges.find((edge) => edge.outcome === branch);
  if (exact) return exact;
  const fallback = edges.find((edge) => edge.outcome === "default");
  if (fallback) return fallback;
  if (node.kind === "condition" || node.kind === "approval") return null;
  return edges.length === 1 ? (edges[0] ?? null) : null;
};

const findTrigger = (document: WorkflowDocument, eventName?: string): WorkflowNode => {
  const triggers = document.nodes.filter((node) => node.kind === "trigger");
  const first = triggers[0];
  if (!first) throw badRequest("Workflow has no trigger");
  if (!eventName) return first;
  const match = triggers.find((node) => node.kind === "trigger" && node.eventName === eventName);
  if (!match) throw badRequest(`No trigger for event "${eventName}"`);
  return match;
};

const nodeById = (document: WorkflowDocument, nodeId: string): WorkflowNode => {
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) throw badRequest(`Workflow step not found: ${nodeId}`);
  return node;
};

const claim = async (deps: WorkflowRuntimeDeps, runId: string): Promise<void> => {
  const now = deps.now();
  if (!(await deps.store.claim(runId, now, now + WORKFLOW_RUN_LEASE_MS))) {
    throw new ORPCError("CONFLICT", { message: "This run is already advancing" });
  }
};

/** A run in the caller's space, or NOT_FOUND. Does not check node access. */
const loadInSpace = async (deps: WorkflowRuntimeDeps, runId: string): Promise<WorkflowRun> => {
  const run = await deps.store.get(runId);
  if (!run || run.spaceId !== deps.spaceId) throw notFound(`Workflow run not found: ${runId}`);
  return run;
};

const remember = async (deps: WorkflowRuntimeDeps, run: WorkflowRun): Promise<WorkflowRun> => {
  run.updatedAt = iso(deps.now());
  const stored = publish(run);
  await deps.store.save(stored);
  return stored;
};

/** The alert for a failed run. The person at the keyboard (if any) already sees it. */
export const workflowRunFailedEvent = (
  run: WorkflowRun,
  actorId: string | null,
): BusabaseNotificationEvent => ({
  kind: "workflow_run.failed",
  spaceId: run.spaceId,
  runId: run.id,
  workflowNodeId: run.workflowNodeId,
  error: run.error ?? "",
  startedBy: run.startedBy,
  actorId,
});

const fail = async (
  deps: WorkflowRuntimeDeps,
  run: WorkflowRun,
  message: string,
): Promise<WorkflowRun> => {
  run.status = "failed";
  run.error = message;
  run.pause = null;
  const stored = await remember(deps, run);
  await deps.notify(workflowRunFailedEvent(stored, personAtKeyboard(deps)));
  return stored;
};

const readBound = async (
  deps: WorkflowRuntimeDeps,
  run: WorkflowRun,
): Promise<WorkflowRecordSnapshot | { error: string }> => {
  if (!run.recordId) {
    return { error: "This run has no recordId. Pass recordId when starting to use read_record." };
  }
  const snapshot = await deps.readRecord(run.recordId);
  if (!snapshot) return { error: `Record not found: ${run.recordId}` };
  return structuredClone(snapshot);
};

type StepResult =
  | { kind: "continue"; branch: string; output: WorkflowStepOutput }
  /** The step ran and the run ends here: the steps after it run elsewhere. */
  | { kind: "finish"; output: WorkflowStepOutput }
  | { kind: "pause"; status: "waiting" | "waiting_approval"; pause: WorkflowRun["pause"] }
  | { kind: "fail"; message: string };

const captured = (
  deps: WorkflowRuntimeDeps,
  kind: string,
  record: WorkflowRecordSnapshot | null,
  data: Record<string, unknown>,
): WorkflowStepOutput => ({
  kind,
  capturedAt: iso(deps.now()),
  record,
  data,
});

/** The bound record at this moment, or null when the run has none. */
const recordForStep = async (
  deps: WorkflowRuntimeDeps,
  run: WorkflowRun,
): Promise<WorkflowRecordSnapshot | null | { error: string }> => {
  if (!run.recordId || boundRecordDeleted(run)) return null;
  return readBound(deps, run);
};

/** This run deleted its own record, so later steps carry on without one rather than fail. */
const boundRecordDeleted = (run: WorkflowRun): boolean =>
  Object.values(run.outputs).some((output) => output.data.deletedRecordId === run.recordId);

const stepInput = (
  run: WorkflowRun,
  node: WorkflowNode,
  record: WorkflowRecordSnapshot | null,
): WorkflowStepInput => {
  const scope = scopeFor(run);
  return {
    event: "workflow.step",
    runId: run.id,
    workflowNodeId: run.workflowNodeId,
    stepId: node.id,
    payload: structuredClone(run.payload),
    record: record ? structuredClone(record) : null,
    recordId: record?.recordId ?? run.recordId,
    baseId: record?.baseId ?? null,
    fields: record ? structuredClone(record.fields) : null,
    steps: structuredClone(scope.steps),
    previous: run.previousNodeId ? structuredClone(scope.input) : null,
  };
};

const executeNode = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: WorkflowNode,
): Promise<StepResult> => {
  if (node.kind === "trigger") {
    const record = await recordForStep(deps, run);
    if (record && "error" in record) return { kind: "fail", message: record.error };
    return {
      kind: "continue",
      branch: "default",
      output: captured(deps, "trigger", record, {
        eventName: node.eventName,
        payload: structuredClone(run.payload),
      }),
    };
  }

  if (node.kind === "wait") {
    const resumeAt = deps.now() + node.duration * UNIT_MS[node.unit];
    return {
      kind: "pause",
      status: "waiting",
      pause: { kind: "wait", nodeId: node.id, resumeAt: iso(resumeAt) },
    };
  }

  if (node.kind === "approval") {
    return {
      kind: "pause",
      status: "waiting_approval",
      pause: { kind: "approval", nodeId: node.id, resumeAt: null },
    };
  }

  if (node.kind === "end") {
    return {
      kind: "continue",
      branch: "default",
      output: captured(deps, "end", null, { outcome: node.outcome }),
    };
  }

  if (node.kind === "condition") {
    try {
      const value = evaluateCondition(node.expression, scopeFor(run));
      return {
        kind: "continue",
        branch: value ? "true" : "false",
        output: captured(deps, "condition", null, { expression: node.expression, value }),
      };
    } catch (error) {
      const message = errorMessage(error, "Condition failed");
      return { kind: "fail", message: `Condition "${node.label}" failed: ${message}` };
    }
  }

  if (node.kind === "action" && node.actionName === WORKFLOW_READ_RECORD_ACTION) {
    const record = await readBound(deps, run);
    if ("error" in record) return { kind: "fail", message: record.error };
    return {
      kind: "continue",
      branch: "success",
      output: captured(deps, "action", record, { actionName: node.actionName }),
    };
  }

  if (node.kind === "action" && RECORD_WRITE_ACTIONS.has(node.actionName)) {
    return runRecordWriteStep(deps, document, run, node);
  }

  if (node.kind === "action" && node.actionName === WORKFLOW_FIND_RECORDS_ACTION) {
    return runFindRecordsStep(deps, document, run, node);
  }

  if (node.kind === "action") {
    return {
      kind: "continue",
      branch: "success",
      output: captured(deps, "action", null, {
        actionName: node.actionName,
        executed: false,
        reason:
          "Only read_record, update_record, create_record, delete_record, and find_records run in this runtime. This action was recorded and skipped.",
      }),
    };
  }

  if (node.kind === "webhook") return runWebhookStep(deps, document, run, node);

  return runFunctionStep(deps, document, run, node);
};

/** Failure under error policy `continue`: record it on the step, take the success branch. */
const failOrContinue = (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  kind: string,
  record: WorkflowRecordSnapshot | null,
  message: string,
  data: Record<string, unknown>,
): StepResult => {
  if (document.settings.errorPolicy === "continue") {
    return {
      kind: "continue",
      branch: "success",
      output: captured(deps, kind, record, { ...data, executed: false }),
    };
  }
  return { kind: "fail", message };
};

/**
 * What a field setting means: plain JSON is stored as written; a string that
 * starts with `=` is a formula over earlier steps; `==` stores a literal `=`.
 * A formula that finds nothing is an error rather than an empty field, so a
 * typo does not quietly blank a column.
 */
const resolveFieldValues = (
  fields: Record<string, unknown>,
  scope: ExpressionScope,
): Record<string, unknown> => {
  const values: Record<string, unknown> = {};
  for (const [key, setting] of Object.entries(fields)) {
    if (typeof setting !== "string" || !setting.startsWith("=")) {
      values[key] = structuredClone(setting);
    } else if (setting.startsWith("==")) {
      values[key] = setting.slice(1);
    } else {
      const value = evaluateValue(setting.slice(1), scope);
      if (value === undefined) throw new Error(`"${setting}" has no value yet`);
      values[key] = value;
    }
  }
  return values;
};

const RECORD_WRITE_ACTIONS: ReadonlySet<string> = new Set([
  WORKFLOW_UPDATE_RECORD_ACTION,
  WORKFLOW_CREATE_RECORD_ACTION,
  WORKFLOW_DELETE_RECORD_ACTION,
]);

/** The record a write acts on: the step's setting, or the run's own record. */
const resolveTargetRecord = (
  setting: string,
  run: WorkflowRun,
  scope: ExpressionScope,
): string | null => {
  const trimmed = setting.trim();
  if (!trimmed) return run.recordId;
  if (!trimmed.startsWith("=")) return trimmed;
  const value = evaluateValue(trimmed.slice(1), scope);
  if (typeof value !== "string" || !value) {
    throw new Error(`"${trimmed}" did not give a record id`);
  }
  return value;
};

/**
 * Create, update, or delete a record as the person the run acts as. A change
 * that went to review rather than applying fails the step, because the steps
 * after it would otherwise work from a record that did not change.
 */
const runRecordWriteStep = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: Extract<WorkflowNode, { kind: "action" }>,
): Promise<StepResult> => {
  const action = node.actionName;
  const label = `${WRITE_ACTION_NAMES[action] ?? "Write"} step "${node.label}"`;
  const data = { actionName: action };
  const message = `Workflow step "${node.label}"`;
  const stop = (reason: string, extra: Record<string, unknown>) =>
    failOrContinue(deps, document, "action", null, reason, { ...data, ...extra });
  const sentToReview = (changeRequestId: string, unchanged: string) =>
    stop(
      `${label} was sent for review (change request ${changeRequestId}) because the person this run acts as cannot edit the Base directly. ${unchanged}`,
      { changeRequestId },
    );
  const done = (record: WorkflowRecordSnapshot | null, extra: Record<string, unknown>) =>
    ({
      kind: "continue",
      branch: "success",
      output: captured(deps, "action", record, { ...data, executed: true, ...extra }),
    }) satisfies StepResult;

  try {
    const scope = scopeFor(run);
    if (action === WORKFLOW_CREATE_RECORD_ACTION) {
      const baseId = node.baseId.trim();
      if (!baseId)
        return stop(`${label} needs a Base to create the record in.`, { error: "no base" });
      if (Object.keys(node.fields).length === 0) {
        return stop(`${label} has no fields to set.`, { error: "no fields" });
      }
      const values = resolveFieldValues(node.fields, scope);
      const outcome = await deps.createRecord(baseId, values, message);
      if (!outcome.merged) return sentToReview(outcome.changeRequestId, "No record was created.");
      return done(outcome.record, { createdRecordId: outcome.record.recordId, changed: values });
    }

    const recordId = resolveTargetRecord(node.targetRecordId, run, scope);
    if (!recordId) {
      return stop(`${label} needs a record. Pass recordId when starting the run.`, {
        error: "no record",
      });
    }
    if (action === WORKFLOW_DELETE_RECORD_ACTION) {
      const outcome = await deps.deleteRecord(recordId, message);
      if (!outcome.merged) return sentToReview(outcome.changeRequestId, "The record is unchanged.");
      return done(null, { deletedRecordId: recordId });
    }

    if (Object.keys(node.fields).length === 0) {
      return stop(`${label} has no fields to set.`, { error: "no fields" });
    }
    const values = resolveFieldValues(node.fields, scope);
    const outcome = await deps.updateRecord(recordId, values, message);
    if (!outcome.merged) return sentToReview(outcome.changeRequestId, "The record is unchanged.");
    return done(outcome.record, { updatedRecordId: recordId, changed: values });
  } catch (error) {
    const reason = errorMessage(error, "could not change the record");
    return stop(`${label} failed: ${reason}`, { error: reason });
  }
};

/** The run a Find records step started this one from, if it did. */
const parentRunIdOf = (run: WorkflowRun): string | null =>
  typeof run.payload.parentRunId === "string" ? run.payload.parentRunId : null;

/**
 * List a Base's records as the person the run acts as. Without `forEach` the
 * list is this step's output and the run goes on. With it, the run ends here
 * and one run per record continues at the next step, about that record; the
 * scheduler starts them under the workflow's concurrency.
 *
 * A repeat never runs part of the list: more matches than the limit, a run
 * that is itself one of a repeat, or a backlog of waiting runs fail the step
 * with no run started, whatever the error policy, because carrying on would
 * run the next steps once with no record instead.
 */
const runFindRecordsStep = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: Extract<WorkflowNode, { kind: "action" }>,
): Promise<StepResult> => {
  const label = `Find records step "${node.label}"`;
  const baseId = node.baseId.trim();
  const viewId = node.viewId?.trim() || null;
  const limit = Math.min(
    node.limit ?? WORKFLOW_FIND_RECORDS_DEFAULT_LIMIT,
    WORKFLOW_FIND_RECORDS_MAX,
  );
  const data = { actionName: node.actionName, baseId, viewId, limit };
  if (!baseId) {
    return failOrContinue(deps, document, "action", null, `${label} needs a Base to search.`, {
      ...data,
      error: "no base",
    });
  }

  let found: { records: WorkflowRecordSnapshot[]; total: number };
  try {
    found = await deps.findRecords(baseId, viewId, limit);
  } catch (error) {
    const reason = errorMessage(error, "could not read the records");
    return failOrContinue(deps, document, "action", null, `${label} failed: ${reason}`, {
      ...data,
      error: reason,
    });
  }
  const records = found.records.slice(0, limit);
  if (!node.forEach) {
    return {
      kind: "continue",
      branch: "success",
      output: captured(deps, "action", null, {
        ...data,
        executed: true,
        records,
        count: records.length,
        total: found.total,
        truncated: found.total > records.length,
      }),
    };
  }

  if (found.total > limit) {
    return {
      kind: "fail",
      message: `${label} found ${found.total} records, more than its limit of ${limit}, so no runs were started. Narrow the View, or raise the limit (at most ${WORKFLOW_FIND_RECORDS_MAX}).`,
    };
  }
  if (parentRunIdOf(run)) {
    return {
      kind: "fail",
      message: `${label} cannot run the next steps once per record here: this run is already one of those runs.`,
    };
  }
  const edge = pickEdge(node, outgoing(document, node.id), "success");
  const finished = (childRunIds: string[]): StepResult => ({
    kind: "finish",
    output: captured(deps, "action", null, {
      ...data,
      executed: true,
      forEach: true,
      count: records.length,
      total: found.total,
      childRunIds,
    }),
  });
  if (!edge || records.length === 0) return finished([]);

  const waiting = await deps.store.countWithStatus(deps.spaceId, run.workflowNodeId, "queued");
  if (waiting >= WORKFLOW_MAX_QUEUED_RUNS) {
    return {
      kind: "fail",
      message: `${label} started no runs: ${waiting} runs of this workflow are still waiting their turn. Try again once they finish, or cancel them.`,
    };
  }

  const now = deps.now();
  const sequence = Object.keys(run.outputs).length;
  const childRunIds: string[] = [];
  for (const [index, record] of records.entries()) {
    const child: WorkflowRun = {
      id: deps.createId(),
      spaceId: run.spaceId,
      workflowNodeId: run.workflowNodeId,
      status: "queued",
      trigger: run.trigger,
      startedBy: run.startedBy,
      startedVia: run.startedVia,
      cancelledBy: null,
      cursorNodeId: edge.target,
      previousNodeId: node.id,
      outputs: {
        ...structuredClone(run.outputs),
        // This step, as the child sees it: about its own record.
        [node.id]: {
          ...captured(deps, "action", record, {
            ...data,
            executed: true,
            forEach: true,
            index,
            count: records.length,
            parentRunId: run.id,
          }),
          sequence,
        },
      },
      recordId: record.recordId,
      payload: { ...structuredClone(run.payload), parentRunId: run.id },
      pause: null,
      error: null,
      freshness: WORKFLOW_DATA_FRESHNESS,
      startedAt: iso(now),
      updatedAt: iso(now),
    };
    // A lease that already lapsed: the scheduler may pick the run up at once.
    await deps.store.insert(publish(child), 0);
    childRunIds.push(child.id);
  }
  return finished(childRunIds);
};

const WRITE_ACTION_NAMES: Readonly<Record<string, string>> = {
  [WORKFLOW_UPDATE_RECORD_ACTION]: "Update record",
  [WORKFLOW_CREATE_RECORD_ACTION]: "Create record",
  [WORKFLOW_DELETE_RECORD_ACTION]: "Delete record",
};

const runWebhookStep = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: Extract<WorkflowNode, { kind: "webhook" }>,
): Promise<StepResult> => {
  const loaded = await recordForStep(deps, run);
  if (loaded && "error" in loaded) return { kind: "fail", message: loaded.error };
  const record = loaded;
  const url = node.url.trim();
  const label = `Webhook step "${node.label}" (${node.id})`;
  if (!url) {
    const message = `${label} has no URL.`;
    return failOrContinue(deps, document, "webhook", record, message, {
      method: node.method,
      url,
      error: "No URL",
    });
  }

  let outcome: WorkflowWebhookCallResult;
  try {
    outcome = await deps.sendWebhook({
      method: node.method,
      url,
      timeoutMs: document.settings.timeoutMs,
      body: stepInput(run, node, record),
      headers: node.headers ?? [],
      signingSecret: node.signingSecret ?? null,
    });
  } catch (error) {
    outcome = {
      ok: false,
      message: errorMessage(error, "Webhook request failed"),
      status: null,
      body: null,
      durationMs: 0,
    };
  }

  const data = {
    method: node.method,
    url,
    status: outcome.status,
    body: outcome.body,
    durationMs: outcome.durationMs,
  };
  if (!outcome.ok) {
    return failOrContinue(
      deps,
      document,
      "webhook",
      record,
      `${label} failed: ${outcome.message}`,
      {
        ...data,
        error: outcome.message,
      },
    );
  }
  return {
    kind: "continue",
    branch: "success",
    output: captured(deps, "webhook", record, { ...data, executed: true }),
  };
};

const RUNTIME_RESULT_KEYS = new Set(["result", "logs", "webhookRuleId", "functionName"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const copyFunctionFields = (
  target: Record<string, unknown>,
  value: Record<string, unknown>,
): void => {
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (RUNTIME_RESULT_KEYS.has(key)) continue;
    target[key] = value[key];
  }
};

const runFunctionStep = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: Extract<WorkflowNode, { kind: "function" }>,
): Promise<StepResult> => {
  const loaded = await recordForStep(deps, run);
  if (loaded && "error" in loaded) return { kind: "fail", message: loaded.error };
  const record = loaded;
  if (node.runIn === "sandbox") return startSandboxStep(deps, document, run, node, record);

  let outcome: WorkflowFunctionCallResult;
  try {
    outcome = await deps.executeFunction({
      code: node.code ?? "",
      webhookRuleId: node.webhookRuleId.trim(),
      functionName: node.functionName.trim(),
      recordBaseId: record?.baseId ?? null,
      timeoutMs: document.settings.timeoutMs,
      input: stepInput(run, node, record),
    });
  } catch (error) {
    outcome = { ok: false, message: errorMessage(error, "Function step failed") };
  }

  if (!outcome.ok) {
    const message = `Function step "${node.label}" (${node.id}) failed: ${outcome.message}`;
    return failOrContinue(deps, document, "function", record, message, {
      error: outcome.message,
      webhookRuleId: outcome.ruleId ?? node.webhookRuleId,
      functionName: outcome.functionName ?? node.functionName,
      logs: outcome.logs ?? "",
    });
  }

  const data = functionOutput(outcome.result, outcome.logs);
  data.webhookRuleId = outcome.ruleId;
  data.functionName = outcome.functionName;
  return {
    kind: "continue",
    branch: "success",
    output: captured(deps, "function", record, data),
  };
};

/** What a finished Function step stores: an object's fields copied up, and the raw value as `result`. */
const functionOutput = (result: unknown, logs: string): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  if (isPlainObject(result)) copyFunctionFields(data, result);
  data.executed = true;
  data.result = result ?? null;
  data.logs = logs;
  return data;
};

/** Installing packages has five minutes of its own, and checks are a tick apart: past this, give up. */
const SANDBOX_DEADLINE_MS = WORKFLOW_SANDBOX_TIMEOUT_MS + 6 * 60_000;

/**
 * Start a Function step's code on a sandbox machine and pause the run. The
 * scheduler picks the run up every `WORKFLOW_SANDBOX_POLL_MS` (or its own tick,
 * whichever is later) and `continueSandboxStep` carries on once the code is
 * done, so nothing waits in a request while packages install.
 */
const startSandboxStep = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: Extract<WorkflowNode, { kind: "function" }>,
  record: WorkflowRecordSnapshot | null,
): Promise<StepResult> => {
  const label = `Function step "${node.label}" (${node.id})`;
  const code = node.code ?? "";
  if (!code.trim()) {
    return failOrContinue(deps, document, "function", record, `${label} has no code to run.`, {
      error: "no code",
      runIn: "sandbox",
    });
  }
  let sandboxId: string;
  try {
    ({ sandboxId } = await deps.sandbox.start({
      stepId: node.id,
      code,
      language: node.language ?? "javascript",
      packages: node.packages ?? "",
      input: stepInput(run, node, record),
      timeoutMs: WORKFLOW_SANDBOX_TIMEOUT_MS,
    }));
  } catch (error) {
    const reason = errorMessage(error, "Could not start a sandbox");
    return failOrContinue(deps, document, "function", record, `${label} failed: ${reason}`, {
      error: reason,
      runIn: "sandbox",
    });
  }
  const now = deps.now();
  return {
    kind: "pause",
    status: "waiting",
    pause: {
      kind: "sandbox",
      nodeId: node.id,
      resumeAt: iso(now + WORKFLOW_SANDBOX_POLL_MS),
      sandboxId,
      deadlineAt: iso(now + SANDBOX_DEADLINE_MS),
    },
  };
};

/**
 * Check on a run waiting for sandboxed code. The caller holds the run. Still
 * going: look again later, unless the deadline passed. Done: remove the machine
 * and continue from the step, with what the code returned or why it failed.
 */
const continueSandboxStep = async (
  deps: WorkflowRuntimeDeps,
  run: WorkflowRun,
): Promise<WorkflowRun> => {
  const pause = run.pause;
  const sandboxId = pause?.sandboxId ?? "";
  if (!pause || !sandboxId) return fail(deps, run, "This run lost track of its sandbox");
  let document: WorkflowDocument;
  try {
    await deps.authorizeWorkflow(run.workflowNodeId, "write");
    document = await deps.loadDocument(run.workflowNodeId);
  } catch (error) {
    await deps.sandbox.stop(sandboxId);
    return fail(deps, run, `Could not resume: ${errorMessage(error, "workflow unavailable")}`);
  }
  const node = document.nodes.find((item) => item.id === pause.nodeId);
  if (!node || node.kind !== "function") {
    await deps.sandbox.stop(sandboxId);
    return fail(deps, run, `Step "${pause.nodeId}" is no longer a Function step`);
  }

  let polled: WorkflowSandboxPoll;
  try {
    polled = await deps.sandbox.poll(sandboxId);
  } catch {
    // The provider did not answer this time. Look again, within the deadline.
    polled = { done: false };
  }
  const now = deps.now();
  if (!polled.done) {
    if (!pause.deadlineAt || Date.parse(pause.deadlineAt) > now) {
      run.pause = { ...pause, resumeAt: iso(now + WORKFLOW_SANDBOX_POLL_MS) };
      return remember(deps, run);
    }
    polled = {
      done: true,
      ok: false,
      message: `The code did not finish within ${WORKFLOW_SANDBOX_TIMEOUT_MS / 60_000} minutes`,
      logs: "",
    };
  }
  await deps.sandbox.stop(sandboxId);

  if (polled.ok) {
    return continueFrom(deps, document, run, node, "success", {
      ...functionOutput(polled.result, polled.logs),
      runIn: "sandbox",
    });
  }
  if (document.settings.errorPolicy === "continue") {
    return continueFrom(deps, document, run, node, "success", {
      error: polled.message,
      logs: polled.logs,
      runIn: "sandbox",
      executed: false,
    });
  }
  return fail(deps, run, `Function step "${node.label}" (${node.id}) failed: ${polled.message}`);
};

const advance = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
): Promise<WorkflowRun> => {
  const seen = new Set<string>();
  for (let step = 0; step < WORKFLOW_MAX_STEPS; step += 1) {
    const nodeId = run.cursorNodeId;
    if (!nodeId) {
      run.status = "completed";
      run.pause = null;
      return remember(deps, run);
    }
    if (seen.has(nodeId) || run.outputs[nodeId]) {
      return fail(deps, run, `Workflow step "${nodeId}" repeated; cycles are not executed`);
    }
    seen.add(nodeId);
    const node = document.nodes.find((item) => item.id === nodeId);
    if (!node) return fail(deps, run, `Workflow step not found: ${nodeId}`);

    const result = await executeNode(deps, document, run, node);
    if (result.kind === "fail") return fail(deps, run, result.message);
    if (result.kind === "pause") {
      run.status = result.status;
      run.pause = result.pause;
      run.error = null;
      const stored = await remember(deps, run);
      if (node.kind === "approval") {
        await deps.notify({
          kind: "workflow_run.approval_needed",
          spaceId: stored.spaceId,
          runId: stored.id,
          workflowNodeId: stored.workflowNodeId,
          stepLabel: node.label,
          approvers: parseWorkflowApprovers(node.approver),
          startedBy: stored.startedBy,
          actorId: personAtKeyboard(deps),
        });
      }
      return stored;
    }

    run.outputs[node.id] = { ...result.output, sequence: Object.keys(run.outputs).length };
    run.previousNodeId = node.id;
    if (node.kind === "end" || result.kind === "finish") {
      run.status = "completed";
      run.cursorNodeId = null;
      run.pause = null;
      run.error = null;
      return remember(deps, run);
    }
    const edge = pickEdge(node, outgoing(document, node.id), result.branch);
    if (!edge) {
      return fail(deps, run, `No branch "${result.branch}" from step "${node.label}" (${node.id})`);
    }
    run.cursorNodeId = edge.target;
  }
  return fail(deps, run, `Workflow exceeded ${WORKFLOW_MAX_STEPS} steps`);
};

/**
 * Advance a run the caller already holds, then release it. A throw while
 * advancing (storage, a bug) still releases; the run then reads as
 * interrupted and the scheduler fails it instead of leaving it stuck.
 */
const advanceHeld = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
): Promise<WorkflowRun> => {
  try {
    return await advance(deps, document, run);
  } finally {
    await deps.store.release(run.id);
  }
};

export const startWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  input: StartWorkflowRunInput,
): Promise<WorkflowRun> => {
  const workflowNodeId = await deps.authorizeWorkflow(input.nodeId, "write");
  const document = await deps.loadDocument(workflowNodeId);
  const trigger = findTrigger(document, input.eventName);
  const now = deps.now();
  // Over the workflow's concurrency the run waits its turn as `queued`; the
  // scheduler starts it, as this caller, once a running one finishes.
  const full = !(await hasFreeSlot(deps, workflowNodeId, document));
  const run: WorkflowRun = {
    id: deps.createId(),
    spaceId: deps.spaceId,
    workflowNodeId,
    status: full ? "queued" : "running",
    trigger: "manual",
    startedBy: deps.actorId,
    startedVia: deps.agent
      ? {
          apiKeyId: deps.agent.apiKeyId,
          apiKeyName: deps.agent.apiKeyName,
          channel: deps.agent.channel,
        }
      : null,
    cancelledBy: null,
    cursorNodeId: trigger.id,
    previousNodeId: null,
    outputs: {},
    recordId: input.recordId ?? null,
    payload: structuredClone(input.payload ?? {}),
    pause: null,
    error: null,
    freshness: WORKFLOW_DATA_FRESHNESS,
    startedAt: iso(now),
    updatedAt: iso(now),
  };
  await deps.store.insert(publish(run), now + WORKFLOW_RUN_LEASE_MS);
  if (full) {
    await deps.store.release(run.id);
    return publish(run);
  }
  return advanceHeld(deps, document, run);
};

/**
 * `settings.concurrency` caps how many runs of one workflow execute steps at
 * the same moment. A run paused on a Wait or an approval is not executing and
 * holds no slot. Best effort across replicas: two that count at the same
 * instant can each start one.
 */
const hasFreeSlot = async (
  deps: WorkflowRuntimeDeps,
  workflowNodeId: string,
  document: WorkflowDocument,
): Promise<boolean> =>
  (await deps.store.countWithStatus(deps.spaceId, workflowNodeId, "running")) <
  document.settings.concurrency;

/** An approval is a person's checkpoint unless the step says otherwise, and a key must be able to write. */
const agentRefusal = (
  deps: WorkflowRuntimeDeps,
  node: Extract<WorkflowNode, { kind: "approval" }>,
): string | null => {
  if (!deps.agent) return null;
  if (!node.allowAgents) {
    return `"${node.label}" takes a person's decision. Turn on "Let agents decide" on the step to allow this.`;
  }
  if (!hasApiKeyLevel(deps.agent.ceiling, "write")) {
    return `This API key's permission level (${deps.agent.ceiling}) cannot decide approvals. It needs write.`;
  }
  return null;
};

/** Who may decide this approval step: its named approvers, or writers when it names none. */
const mayDecide = async (
  deps: WorkflowRuntimeDeps,
  workflowNodeId: string,
  node: Extract<WorkflowNode, { kind: "approval" }>,
): Promise<{ allowed: boolean; asWriter: boolean; approvers: string[] }> => {
  const approvers = parseWorkflowApprovers(node.approver);
  const asWriter = await deps.canDriveWorkflow(workflowNodeId);
  if (approvers.length === 0) return { allowed: asWriter, asWriter, approvers };
  return { allowed: await deps.isNamedApprover(approvers), asWriter, approvers };
};

export const getWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  runId: string,
): Promise<WorkflowRun> => {
  const run = await loadInSpace(deps, runId);
  await deps.authorizeWorkflow(run.workflowNodeId, "read");
  return publish(run);
};

export const listWorkflowRuns = async (
  deps: WorkflowRuntimeDeps,
  input: ListWorkflowRunsInput,
): Promise<ListWorkflowRunsOutput> => {
  const workflowNodeId = await deps.authorizeWorkflow(input.nodeId, "read");
  const limit = input.limit ?? 20;
  const [listed, canRun, queuedCount] = await Promise.all([
    input.runId
      ? loadOneOfWorkflow(deps, workflowNodeId, input.runId)
      : deps.store.listForWorkflow(
          deps.spaceId,
          workflowNodeId,
          limit + 1,
          input.cursor ? parseRunCursor(input.cursor) : undefined,
        ),
    deps.canDriveWorkflow(workflowNodeId),
    deps.store.countWithStatus(deps.spaceId, workflowNodeId, "queued"),
  ]);
  const runs = input.runId ? listed : listed.slice(0, limit);
  const lastRun = runs.at(-1);
  const nextCursor = listed.length > runs.length && lastRun ? runCursor(lastRun) : null;
  const pending = runs.filter(
    (run) => run.status === "waiting_approval" && run.pause?.kind === "approval",
  );
  const failed = canRun ? runs.filter((run) => run.status === "failed") : [];
  // The graph is read once, for whichever of the two questions needs it.
  let loaded: Promise<WorkflowDocument> | null = null;
  const loadGraph = () => {
    loaded ??= deps.loadDocument(workflowNodeId);
    return loaded;
  };
  const retryableRunIds: string[] = [];
  if (failed.length > 0) {
    const document = await loadGraph();
    for (const run of failed) {
      if (retryPoint(document, run).ok) retryableRunIds.push(run.id);
    }
  }
  const decidableRunIds =
    pending.length > 0 ? await decidableAmong(deps, await loadGraph(), pending, canRun) : [];
  const actorNames = await deps.resolveActorNames([
    ...new Set(
      runs.flatMap((run) => (run.cancelledBy ? [run.startedBy, run.cancelledBy] : [run.startedBy])),
    ),
  ]);
  return {
    runs: runs.map(publish),
    canRun,
    decidableRunIds,
    retryableRunIds,
    nextCursor,
    queuedCount,
    actorNames,
  };
};

/**
 * Of runs paused on an approval in one workflow, the ones the caller may decide
 * now: a named approver (or a space manager) for a step that names someone,
 * write on the workflow when it names nobody, and for an agent a step that
 * allows agents. `canRun` is write on the workflow.
 */
const decidableAmong = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  pending: readonly WorkflowRun[],
  canRun: boolean,
): Promise<string[]> => {
  const decidable: string[] = [];
  const verdicts = new Map<string, boolean>();
  for (const run of pending) {
    const node = document.nodes.find((item) => item.id === run.pause?.nodeId);
    if (node?.kind !== "approval" || agentRefusal(deps, node)) continue;
    const key = parseWorkflowApprovers(node.approver).join(",");
    if (!verdicts.has(key)) {
      verdicts.set(key, key ? await deps.isNamedApprover(key.split(",")) : canRun);
    }
    if (verdicts.get(key)) decidable.push(run.id);
  }
  return decidable;
};

/** The most runs waiting on an approval that one call looks at, across the space. */
const WAITING_APPROVAL_SCAN = 200;

/**
 * Runs waiting on a decision the caller may make, across every workflow they
 * can read: what a phone shows as "waiting for me". Each workflow is judged on
 * its own (a run in a workflow the caller cannot read is left out, never
 * revealed), by the same rule as the Runs tab.
 */
export const listWaitingWorkflowRuns = async (
  deps: WorkflowRuntimeDeps,
  input: ListWaitingWorkflowRunsInput,
): Promise<ListWaitingWorkflowRunsOutput> => {
  const limit = input.limit ?? 50;
  const waiting = await deps.store.listWaitingApproval(deps.spaceId, WAITING_APPROVAL_SCAN);
  const byWorkflow = new Map<string, WorkflowRun[]>();
  for (const run of waiting) {
    byWorkflow.set(run.workflowNodeId, [...(byWorkflow.get(run.workflowNodeId) ?? []), run]);
  }
  const items: ListWaitingWorkflowRunsOutput["items"] = [];
  for (const [workflowNodeId, runs] of byWorkflow) {
    let document: WorkflowDocument;
    let canRun: boolean;
    let workflowName: string;
    try {
      await deps.authorizeWorkflow(workflowNodeId, "read");
      document = await deps.loadDocument(workflowNodeId);
      canRun = await deps.canDriveWorkflow(workflowNodeId);
      workflowName = (await deps.describeWorkflow(workflowNodeId)).name;
    } catch {
      continue;
    }
    const decidable = new Set(await decidableAmong(deps, document, runs, canRun));
    for (const run of runs) {
      if (!decidable.has(run.id)) continue;
      const step = document.nodes.find((node) => node.id === run.pause?.nodeId);
      items.push({ run: publish(run), workflowName, stepLabel: step?.label ?? "" });
    }
  }
  items.sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt));
  const shown = items.slice(0, limit);
  const actorNames = await deps.resolveActorNames([
    ...new Set(shown.map((item) => item.run.startedBy)),
  ]);
  return { items: shown, actorNames };
};

const runCursor = (run: WorkflowRun): string => `${run.startedAt}|${run.id}`;

const parseRunCursor = (cursor: string): WorkflowRunPosition => {
  const [startedAt, id] = cursor.split("|");
  if (!startedAt || !id || Number.isNaN(Date.parse(startedAt))) {
    throw badRequest("Invalid cursor");
  }
  return { startedAt, id };
};

/** One run, only if it belongs to this workflow: a link must not reach across workflows. */
const loadOneOfWorkflow = async (
  deps: WorkflowRuntimeDeps,
  workflowNodeId: string,
  runId: string,
): Promise<WorkflowRun[]> => {
  const run = await deps.store.get(runId);
  return run && run.spaceId === deps.spaceId && run.workflowNodeId === workflowNodeId ? [run] : [];
};

/** Move past a paused step and advance. The caller holds the run. */
const continueFrom = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: WorkflowNode,
  branch: string,
  data: Record<string, unknown>,
): Promise<WorkflowRun> => {
  run.outputs[node.id] = {
    ...captured(deps, node.kind, null, data),
    sequence: Object.keys(run.outputs).length,
  };
  run.previousNodeId = node.id;
  const edge = pickEdge(node, outgoing(document, node.id), branch);
  if (!edge) {
    return fail(deps, run, `No branch "${branch}" from step "${node.label}" (${node.id})`);
  }
  run.cursorNodeId = edge.target;
  run.status = "running";
  run.pause = null;
  run.error = null;
  return advance(deps, document, run);
};

export const resumeWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  input: ResumeWorkflowRunInput,
): Promise<WorkflowRun> => {
  const stored = await loadInSpace(deps, input.runId);
  await deps.authorizeWorkflow(stored.workflowNodeId, "write");
  await claim(deps, stored.id);
  try {
    // Re-read under the lease: another worker may have moved it on.
    const run = await loadInSpace(deps, stored.id);
    if (run.status !== "waiting" || run.pause?.kind !== "wait" || !run.pause.resumeAt) {
      throw badRequest("This run is not waiting on a Wait step");
    }
    const resumeAt = Date.parse(run.pause.resumeAt);
    const early = deps.now() < resumeAt;
    if (early && input.force !== true) {
      throw badRequest(
        `Wait has not elapsed. Resume after ${run.pause.resumeAt}, or pass force to continue now.`,
      );
    }
    const document = await deps.loadDocument(run.workflowNodeId);
    const node = nodeById(document, run.pause.nodeId);
    if (node.kind !== "wait") {
      return await fail(deps, run, `Step "${run.pause.nodeId}" is no longer a Wait`);
    }
    return await continueFrom(deps, document, run, node, "elapsed", {
      resumeAt: run.pause.resumeAt,
      resumedAt: iso(deps.now()),
      forced: early,
    });
  } finally {
    await deps.store.release(stored.id);
  }
};

export const decideWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  input: DecideWorkflowRunInput,
): Promise<WorkflowRun> => {
  const stored = await loadInSpace(deps, input.runId);
  // Read is enough to reach the step: who may decide it depends on the step.
  await deps.authorizeWorkflow(stored.workflowNodeId, "read");
  await claim(deps, stored.id);
  try {
    const run = await loadInSpace(deps, stored.id);
    if (run.status !== "waiting_approval" || run.pause?.kind !== "approval") {
      throw badRequest("This run is not waiting for approval");
    }
    const document = await deps.loadDocument(run.workflowNodeId);
    const node = nodeById(document, run.pause.nodeId);
    if (node.kind !== "approval") {
      return await fail(deps, run, `Step "${run.pause.nodeId}" is no longer an approval`);
    }
    const refusal = agentRefusal(deps, node);
    if (refusal) throw new ORPCError("FORBIDDEN", { message: refusal });
    const { allowed, asWriter, approvers } = await mayDecide(deps, run.workflowNodeId, node);
    if (!allowed) {
      throw new ORPCError("FORBIDDEN", {
        message:
          approvers.length > 0
            ? `Only the approvers named on "${node.label}" can decide it: ${approvers.join(", ")}`
            : "Requires write access on this node",
      });
    }
    const data = {
      decision: input.decision,
      approver: node.approver,
      decidedBy: deps.actorId,
      // Who pressed the button when it was not the person themselves.
      ...(deps.agent
        ? { decidedVia: { apiKeyName: deps.agent.apiKeyName, channel: deps.agent.channel } }
        : {}),
    };
    if (asWriter) return await continueFrom(deps, document, run, node, input.decision, data);
    // A named approver who cannot edit the workflow decides, but the steps
    // after the decision run as the person who started the run: the scheduler
    // picks the run up from the next step with that person's access.
    return await handOff(deps, document, run, node, input.decision, data);
  } finally {
    await deps.store.release(stored.id);
  }
};

/** Record a decision and leave the rest of the run to the scheduler. */
const handOff = async (
  deps: WorkflowRuntimeDeps,
  document: WorkflowDocument,
  run: WorkflowRun,
  node: WorkflowNode,
  branch: string,
  data: Record<string, unknown>,
): Promise<WorkflowRun> => {
  run.outputs[node.id] = {
    ...captured(deps, node.kind, null, data),
    sequence: Object.keys(run.outputs).length,
  };
  run.previousNodeId = node.id;
  const edge = pickEdge(node, outgoing(document, node.id), branch);
  if (!edge) {
    return fail(deps, run, `No branch "${branch}" from step "${node.label}" (${node.id})`);
  }
  run.cursorNodeId = edge.target;
  run.status = "queued";
  run.pause = null;
  run.error = null;
  return remember(deps, run);
};

/**
 * The step a failed run can run again from, or why it cannot. A run stopped on
 * a step that never finished: its cursor is still on that step, which has no
 * output. A failure after a step finished (no branch to take) leaves an output
 * on the cursor's step, so retrying would only repeat the same failure.
 */
const retryPoint = (
  document: WorkflowDocument,
  run: WorkflowRun,
): { ok: true; node: WorkflowNode } | { ok: false; reason: string } => {
  if (run.status !== "failed") return { ok: false, reason: "Only a failed run can be retried" };
  if (typeof run.payload.retriedAs === "string") {
    return { ok: false, reason: `This run was already retried as ${run.payload.retriedAs}` };
  }
  const nodeId = run.cursorNodeId;
  if (!nodeId || run.outputs[nodeId]) {
    return { ok: false, reason: "This run did not stop on a step that can run again" };
  }
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return {
      ok: false,
      reason: `Step "${nodeId}" is no longer in this workflow, so there is nothing to retry from`,
    };
  }
  return { ok: true, node };
};

/**
 * Run a failed run again from the step it stopped on. The new run carries the
 * earlier steps' outputs exactly as the failed run stored them, so nothing
 * before the failed step runs again (some of those steps may have sent mail),
 * and it acts as whoever retries. The failed step runs again, with its current
 * settings and the record's current values.
 *
 * A failed run is retried once: it keeps `retriedAs`, so a second click, a
 * second tab, or an agent that retries on a timeout cannot send the step's
 * request twice. If the new run fails too, that run is retried in turn.
 */
export const retryWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  input: RetryWorkflowRunInput,
): Promise<WorkflowRun> => {
  const stored = await loadInSpace(deps, input.runId);
  const workflowNodeId = await deps.authorizeWorkflow(stored.workflowNodeId, "write");
  await claim(deps, stored.id);
  let document: WorkflowDocument;
  let next: WorkflowRun;
  let full: boolean;
  try {
    const failed = await loadInSpace(deps, stored.id);
    document = await deps.loadDocument(workflowNodeId);
    const point = retryPoint(document, failed);
    if (!point.ok) {
      throw typeof failed.payload.retriedAs === "string"
        ? new ORPCError("CONFLICT", { message: point.reason })
        : badRequest(point.reason);
    }
    const now = deps.now();
    full = !(await hasFreeSlot(deps, workflowNodeId, document));
    const { retriedAs: _earlier, ...payload } = structuredClone(failed.payload);
    next = {
      id: deps.createId(),
      spaceId: deps.spaceId,
      workflowNodeId,
      status: full ? "queued" : "running",
      trigger: failed.trigger,
      startedBy: deps.actorId,
      startedVia: deps.agent
        ? {
            apiKeyId: deps.agent.apiKeyId,
            apiKeyName: deps.agent.apiKeyName,
            channel: deps.agent.channel,
          }
        : null,
      cancelledBy: null,
      cursorNodeId: failed.cursorNodeId,
      previousNodeId: failed.previousNodeId,
      outputs: structuredClone(failed.outputs),
      recordId: failed.recordId,
      payload: { ...payload, retryOf: failed.id },
      pause: null,
      error: null,
      freshness: WORKFLOW_DATA_FRESHNESS,
      startedAt: iso(now),
      updatedAt: iso(now),
    };
    await deps.store.insert(publish(next), now + WORKFLOW_RUN_LEASE_MS);
    failed.payload = { ...failed.payload, retriedAs: next.id };
    await remember(deps, failed);
  } finally {
    await deps.store.release(stored.id);
  }
  if (full) {
    // Over the workflow's concurrency: the scheduler starts it, as this caller.
    await deps.store.release(next.id);
    return publish(next);
  }
  return advanceHeld(deps, document, next);
};

/**
 * Stop one run before it finishes. Only a run that is not executing a step can
 * be stopped: a step already sent (a webhook, a function) cannot be taken back,
 * and pretending otherwise would hide that it ran.
 */
export const cancelWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  input: CancelWorkflowRunInput,
): Promise<WorkflowRun> => {
  const stored = await loadInSpace(deps, input.runId);
  await deps.authorizeWorkflow(stored.workflowNodeId, "write");
  const claimedAt = deps.now();
  if (!(await deps.store.claim(stored.id, claimedAt, claimedAt + WORKFLOW_RUN_LEASE_MS))) {
    throw new ORPCError("CONFLICT", {
      message: "This run is executing a step right now. Cancel it once that step has finished.",
    });
  }
  try {
    const run = await loadInSpace(deps, stored.id);
    if (FINISHED_WORKFLOW_RUN_STATUSES.includes(run.status)) {
      throw badRequest("This run has already finished");
    }
    if (run.status === "running") {
      throw new ORPCError("CONFLICT", {
        message: "This run is executing a step right now. Cancel it once that step has finished.",
      });
    }
    const sandboxId = run.pause?.kind === "sandbox" ? run.pause.sandboxId : undefined;
    run.status = "cancelled";
    run.cancelledBy = deps.actorId;
    run.pause = null;
    run.error = null;
    const cancelled = await remember(deps, run);
    // The code would otherwise keep running, on a machine someone pays for.
    if (sandboxId) await deps.sandbox.stop(sandboxId);
    return cancelled;
  } finally {
    await deps.store.release(stored.id);
  }
};

/** Stop every queued run of one workflow, such as the runs a bulk import queued by mistake. */
export const cancelQueuedWorkflowRuns = async (
  deps: WorkflowRuntimeDeps,
  input: CancelQueuedWorkflowRunsInput,
): Promise<CancelQueuedWorkflowRunsOutput> => {
  const workflowNodeId = await deps.authorizeWorkflow(input.nodeId, "write");
  return {
    cancelled: await deps.store.cancelQueued(
      deps.spaceId,
      workflowNodeId,
      deps.actorId,
      deps.now(),
    ),
  };
};

/**
 * Advance a queued run: one a record event queued (it starts at its trigger),
 * one that waited for a concurrency slot, or one handed off after a named
 * approver's decision (it continues at the step after the approval). The
 * caller has bound the run's `startedBy` as the acting user, so the access
 * check is theirs. Returns null, leaving it queued, while the workflow is at
 * its concurrency.
 */
const startQueuedRun = async (
  deps: WorkflowRuntimeDeps,
  run: WorkflowRun,
): Promise<WorkflowRun | null> => {
  let document: WorkflowDocument;
  try {
    await deps.authorizeWorkflow(run.workflowNodeId, "write");
    document = await deps.loadDocument(run.workflowNodeId);
  } catch (error) {
    return fail(deps, run, `Could not start: ${errorMessage(error, "workflow unavailable")}`);
  }
  const next = run.cursorNodeId ? document.nodes.find((n) => n.id === run.cursorNodeId) : null;
  const fresh = Object.keys(run.outputs).length === 0;
  if (fresh && next?.kind !== "trigger") {
    return fail(deps, run, "The trigger that queued this run is no longer in the workflow");
  }
  if (!next) {
    return fail(deps, run, `Workflow step not found: ${run.cursorNodeId ?? "(none)"}`);
  }
  if (!(await hasFreeSlot(deps, run.workflowNodeId, document))) return null;
  run.status = "running";
  return advance(deps, document, run);
};

/**
 * Continue one due run (queued, or a Wait whose time passed) as whoever the
 * host bound. Used by the scheduler. Never throws for a run-level problem:
 * the run is failed with the reason instead, so it does not come back every
 * tick. Returns null when another worker holds the run or it is no longer due.
 */
export const continueDueWorkflowRun = async (
  deps: WorkflowRuntimeDeps,
  runId: string,
): Promise<WorkflowRun | null> => {
  const now = deps.now();
  if (!(await deps.store.claim(runId, now, now + WORKFLOW_RUN_LEASE_MS))) return null;
  try {
    const run = await loadInSpace(deps, runId);
    if (run.status === "queued") return await startQueuedRun(deps, run);
    if (run.status === "waiting" && run.pause?.kind === "sandbox") {
      if (!run.pause.resumeAt || Date.parse(run.pause.resumeAt) > now) return null;
      return await continueSandboxStep(deps, run);
    }
    if (
      run.status !== "waiting" ||
      run.pause?.kind !== "wait" ||
      !run.pause.resumeAt ||
      Date.parse(run.pause.resumeAt) > now
    ) {
      return null;
    }
    let document: WorkflowDocument;
    try {
      await deps.authorizeWorkflow(run.workflowNodeId, "write");
      document = await deps.loadDocument(run.workflowNodeId);
    } catch (error) {
      return await fail(
        deps,
        run,
        `Could not resume: ${errorMessage(error, "workflow unavailable")}`,
      );
    }
    const node = document.nodes.find((item) => item.id === run.pause?.nodeId);
    if (!node || node.kind !== "wait") {
      return await fail(deps, run, `Step "${run.pause.nodeId}" is no longer a Wait`);
    }
    return await continueFrom(deps, document, run, node, "elapsed", {
      resumeAt: run.pause.resumeAt,
      resumedAt: iso(deps.now()),
      forced: false,
    });
  } finally {
    await deps.store.release(runId);
  }
};

/**
 * Fail a run from outside any request: its worker vanished mid-step, or the
 * host could not act as its `startedBy` any more. Only touches a run still in
 * one of `onlyIf`, so a run that moved on meanwhile is left alone.
 */
export const failWorkflowRunFromHost = async (
  store: WorkflowRunStore,
  runId: string,
  now: number,
  message: string,
  onlyIf: readonly WorkflowRun["status"][],
): Promise<WorkflowRun | null> => {
  if (!(await store.claim(runId, now, now + WORKFLOW_RUN_LEASE_MS))) return null;
  try {
    const current = await store.get(runId);
    if (!current || !onlyIf.includes(current.status)) return null;
    const failed = publish({
      ...current,
      status: "failed",
      pause: null,
      error: message,
      updatedAt: iso(now),
    });
    await store.save(failed);
    return failed;
  } finally {
    await store.release(runId);
  }
};

/**
 * Continue every Wait in the caller's space whose time has passed, as the
 * caller. One run that cannot continue is reported and does not stop the rest.
 */
export const resumeElapsedWorkflowRuns = async (
  deps: WorkflowRuntimeDeps,
): Promise<ResumeElapsedWorkflowRunsOutput> => {
  // Sandboxed code is not a Wait: the scheduler checks on it, and it cannot be hurried.
  const due = (await deps.store.listElapsedWaits(deps.spaceId, deps.now())).filter(
    (run) => run.pause?.kind === "wait",
  );
  const runs: WorkflowRun[] = [];
  const failed: ResumeElapsedWorkflowRunsOutput["failed"] = [];
  for (const run of due) {
    try {
      runs.push(await resumeWorkflowRun(deps, { runId: run.id }));
    } catch (error) {
      failed.push({ runId: run.id, message: errorMessage(error, "Could not resume") });
    }
  }
  return { runs, failed };
};
