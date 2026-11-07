import "server-only";

import { ORPCError } from "@orpc/server";
import {
  type CancelQueuedWorkflowRunsInput,
  type CancelWorkflowRunInput,
  type DecideWorkflowRunInput,
  type ListWorkflowRunsInput,
  type ResumeWorkflowRunInput,
  type StartWorkflowRunInput,
  WORKFLOW_RUN_RETENTION_DAYS,
  type WorkflowRecordSnapshot,
  type WorkflowRun,
} from "busabase-contract/domains/workflow/run";
import {
  type BusabaseDatabase,
  type BusabaseNotificationEvent,
  getContextAgentCaller,
  getContextIsSpaceManager,
  getContextSpaceId,
  resolveActorId,
  resolveUserRefs,
} from "../../../context";
import { getDb } from "../../../db";
import { CURRENT_USER_ID, id } from "../../../logic/kernel";
import { assertNodePermission, hasNodePermission } from "../../../logic/node-acl";
import { resolveVisibleNodeOfTypes } from "../../../logic/node-resolve";
import { emitNotificationEvent } from "../../../logic/node-subscriptions";
import { getRecord, listRecordsPage } from "../../base/logic/queries";
import {
  createChangeRequest,
  createDeleteChangeRequest,
  createUpdateChangeRequest,
} from "../../base/logic/record-ops";
import { readRichNodeDocument } from "../../rich-node/handlers";
import { runFunction } from "../../webhook/logic/sandbox";
import {
  buildWorkflowHookRequest,
  pickWorkflowHookResponse,
  WORKFLOW_HOOK_MAX_BODY_BYTES,
  type WorkflowHookRequest,
  type WorkflowHookResponse,
} from "../utils/hook";
import { loadWorkflowFunctionSource } from "./function-rule-store";
import { toWorkflowRecordSnapshot } from "./record-snapshot";
import { createDbWorkflowRunStore } from "./run-store-db";
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
  type WorkflowFunctionCall,
  type WorkflowFunctionCallResult,
  type WorkflowRuntimeDeps,
  workflowRunFailedEvent,
} from "./runs";
import {
  enqueueDueScheduledRuns,
  enqueueWorkflowHookRun,
  runWithoutWorkflowTriggers,
} from "./triggers";
import { sendWorkflowWebhook } from "./webhook-step";

const executeStoredFunction = async (
  spaceId: string,
  call: WorkflowFunctionCall,
): Promise<WorkflowFunctionCallResult> => {
  if (call.code.trim()) {
    // Code written in the step: the same sandbox as a saved rule, with the
    // workflow's own timeout.
    const ran = await runFunction(call.code, call.input, call.timeoutMs);
    if (ran.error) {
      return { ok: false, message: ran.error, ruleId: "", functionName: "", logs: ran.logs };
    }
    return {
      ok: true,
      ruleId: "",
      functionName: "",
      result: ran.result === undefined ? null : ran.result,
      logs: ran.logs,
    };
  }
  const loaded = await loadWorkflowFunctionSource(await getDb(), spaceId, {
    webhookRuleId: call.webhookRuleId,
    functionName: call.functionName,
    recordBaseId: call.recordBaseId,
  });
  if (!loaded.ok) return loaded;
  const timeoutMs = Math.min(loaded.source.timeoutMs, call.timeoutMs);
  const ran = await runFunction(loaded.source.code, call.input, timeoutMs);
  if (ran.error) {
    return {
      ok: false,
      message: ran.error,
      ruleId: loaded.source.ruleId,
      functionName: loaded.source.name,
      logs: ran.logs,
    };
  }
  return {
    ok: true,
    ruleId: loaded.source.ruleId,
    functionName: loaded.source.name,
    result: ran.result === undefined ? null : ran.result,
    logs: ran.logs,
  };
};

const authorizeWorkflow = async (nodeId: string, level: "read" | "write"): Promise<string> => {
  const node = await resolveVisibleNodeOfTypes(
    nodeId,
    ["workflow"],
    (other) =>
      new ORPCError("BAD_REQUEST", {
        message: `Node ${other.id} is a ${other.type}, not a workflow`,
      }),
  );
  await assertNodePermission(node.id, level);
  return node.id;
};

/**
 * A space manager may always decide (the escape hatch when a named approver
 * is away); otherwise the actor's email must be on the list.
 */
const isNamedApproverForActor = async (approvers: readonly string[]): Promise<boolean> => {
  if (getContextIsSpaceManager()) return true;
  const actorId = resolveActorId(CURRENT_USER_ID);
  const email = (await resolveUserRefs([actorId])).get(actorId)?.email?.trim().toLowerCase();
  return Boolean(email && approvers.includes(email));
};

/**
 * Apply a workflow step's field changes as the acting person: a direct edit if
 * they may edit the Base, a change request for review if not. A change merged
 * here starts no workflows, or a step editing its own record would start the
 * workflow again.
 */
export const updateRecordForWorkflow: WorkflowRuntimeDeps["updateRecord"] = (
  recordId,
  fields,
  message,
) =>
  runWithoutWorkflowTriggers(async () => {
    const result = await createUpdateChangeRequest(recordId, {
      fields,
      message,
      author: resolveActorId(CURRENT_USER_ID),
    });
    if (!result.materialized) return { merged: false as const, changeRequestId: result.id };
    const record = await getRecord(recordId);
    if (!record) throw new ORPCError("NOT_FOUND", { message: `Record not found: ${recordId}` });
    return { merged: true as const, record: toWorkflowRecordSnapshot(record) };
  });

/** Add a record as the acting person, under the same rules as `updateRecordForWorkflow`. */
export const createRecordForWorkflow: WorkflowRuntimeDeps["createRecord"] = (
  baseId,
  fields,
  message,
) =>
  runWithoutWorkflowTriggers(async () => {
    const result = await createChangeRequest(baseId, {
      fields,
      message,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
    if (!result.materialized) return { merged: false as const, changeRequestId: result.id };
    const record = await getRecord(result.id);
    if (!record) throw new ORPCError("NOT_FOUND", { message: `Record not found: ${result.id}` });
    return { merged: true as const, record: toWorkflowRecordSnapshot(record) };
  });

/** Move a record to the trash as the acting person, under the same rules. */
export const deleteRecordForWorkflow: WorkflowRuntimeDeps["deleteRecord"] = (recordId, message) =>
  runWithoutWorkflowTriggers(async () => {
    const result = await createDeleteChangeRequest(recordId, {
      message,
      submittedBy: resolveActorId(CURRENT_USER_ID),
      deleteMode: "archive",
    });
    return result.materialized
      ? { merged: true as const }
      : { merged: false as const, changeRequestId: result.id };
  });

/** Rows per page when a Find records step reads a Base: the most one page may hold. */
const FIND_RECORDS_PAGE_SIZE = 100;

/**
 * A Find records step's read, through the same listing the Base's own pages
 * use: only records the acting person may see, filtered and sorted exactly as
 * the View shows them.
 */
const findRecordsForWorkflow: WorkflowRuntimeDeps["findRecords"] = async (
  baseId,
  viewId,
  limit,
) => {
  const records: WorkflowRecordSnapshot[] = [];
  let total = 0;
  for (let page = 1; records.length < limit; page += 1) {
    const listed = await listRecordsPage({
      baseId,
      ...(viewId ? { viewId } : {}),
      page,
      pageSize: FIND_RECORDS_PAGE_SIZE,
    });
    total = listed.total;
    records.push(...listed.records.map(toWorkflowRecordSnapshot));
    if (page >= listed.totalPages) break;
  }
  return { records: records.slice(0, limit), total };
};

const resolveActorNames = async (actorIds: readonly string[]) => {
  const refs = await resolveUserRefs(actorIds);
  return Object.fromEntries(
    [...refs].flatMap(([id, ref]) => {
      const name = ref.name?.trim() || ref.email?.trim();
      return name ? [[id, name]] : [];
    }),
  );
};

/** Real dependencies, bound to whoever the current context says is acting. */
const liveDeps = (options: { background?: boolean } = {}): WorkflowRuntimeDeps => {
  const spaceId = getContextSpaceId();
  return {
    spaceId,
    actorId: resolveActorId(CURRENT_USER_ID),
    store: createDbWorkflowRunStore(getDb),
    now: () => Date.now(),
    readRecord: async (recordId) => {
      const record = await getRecord(recordId);
      if (!record || record.status !== "active") return null;
      return toWorkflowRecordSnapshot(record);
    },
    authorizeWorkflow,
    canDriveWorkflow: (nodeId) => hasNodePermission(nodeId, "write"),
    isNamedApprover: isNamedApproverForActor,
    updateRecord: updateRecordForWorkflow,
    createRecord: createRecordForWorkflow,
    deleteRecord: deleteRecordForWorkflow,
    findRecords: findRecordsForWorkflow,
    loadDocument: (nodeId) => readRichNodeDocument(nodeId, "workflow"),
    executeFunction: (call) => executeStoredFunction(spaceId, call),
    sendWebhook: sendWorkflowWebhook,
    createId: () => id("wfr"),
    resolveActorNames,
    notify: emitNotificationEvent,
    background: options.background ?? false,
    // The scheduler is not a request from anyone, whoever the run belongs to.
    agent: options.background ? null : getContextAgentCaller(),
  };
};

export const startStoredWorkflowRun = (input: StartWorkflowRunInput) =>
  startWorkflowRun(liveDeps(), input);

export const getStoredWorkflowRun = (runId: string) => getWorkflowRun(liveDeps(), runId);

export const listStoredWorkflowRuns = (input: ListWorkflowRunsInput) =>
  listWorkflowRuns(liveDeps(), input);

export const resumeStoredWorkflowRun = (input: ResumeWorkflowRunInput) =>
  resumeWorkflowRun(liveDeps(), input);

export const decideStoredWorkflowRun = (input: DecideWorkflowRunInput) =>
  decideWorkflowRun(liveDeps(), input);

export const cancelStoredWorkflowRun = (input: CancelWorkflowRunInput) =>
  cancelWorkflowRun(liveDeps(), input);

export const cancelQueuedStoredWorkflowRuns = (input: CancelQueuedWorkflowRunsInput) =>
  cancelQueuedWorkflowRuns(liveDeps(), input);

export const resumeElapsedStoredWorkflowRuns = () => resumeElapsedWorkflowRuns(liveDeps());

/** Queue runs for schedules that are due. `processDueWorkflowRuns` calls it on every tick. */
export { enqueueDueScheduledRuns };

/**
 * How a host runs code as one member of one space, outside any request. The
 * cloud builds the member's real ACL context; the open-source app has a single
 * local user. Must throw when the actor may no longer act in that space.
 */
export type WorkflowRunAs = <T>(
  actor: { spaceId: string; actorId: string; startedVia: WorkflowRun["startedVia"] },
  fn: () => Promise<T>,
) => Promise<T>;

export interface ProcessDueWorkflowRunsResult {
  /** Runs moved forward: started, resumed, or failed with a reason. */
  continued: number;
  /** Runs failed because their worker vanished mid-step. */
  interrupted: number;
  /** Runs failed because the host could not act as their `startedBy`. */
  orphaned: number;
  /** Due runs left for the next tick (time budget spent, or another worker holds them). */
  deferred: number;
  /** Finished runs deleted because they passed `WORKFLOW_RUN_RETENTION_DAYS`. */
  purged: number;
  /** Runs queued by schedules that came due this tick. */
  scheduled: number;
}

/** Finished runs deleted per tick, so one tick never turns into a long delete. */
const WORKFLOW_RUN_PURGE_BATCH = 500;
const DAY_MS = 86_400_000;

/**
 * The scheduler tick, across every space. Starts queued event runs and
 * continues Waits whose time has passed, each as its run's `startedBy`, then
 * returns. Hosts call it on a timer (`/api/scheduler/tick` in the cloud, an
 * in-process interval in the open-source app).
 *
 * `budgetMs` keeps one tick under the host's request limit; whatever is left
 * waits for the next tick.
 */
export const processDueWorkflowRuns = async (options: {
  db: BusabaseDatabase;
  runAs: WorkflowRunAs;
  limit?: number;
  budgetMs?: number;
  /**
   * Alerts for runs the tick fails outside any member's context. Hosts without
   * notifications leave it out.
   */
  notify?: (event: BusabaseNotificationEvent) => void | Promise<void>;
}): Promise<ProcessDueWorkflowRunsResult> => {
  const store = createDbWorkflowRunStore(() => options.db);
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? 40_000;
  const result: ProcessDueWorkflowRunsResult = {
    continued: 0,
    interrupted: 0,
    orphaned: 0,
    deferred: 0,
    purged: 0,
    scheduled: 0,
  };
  const announceFailure = async (run: WorkflowRun) => {
    try {
      await options.notify?.(workflowRunFailedEvent(run, null));
    } catch (error) {
      console.error("[busabase] workflow run failure alert failed", run.id, error);
    }
  };

  // Schedules first, so a run that comes due now starts in this same tick.
  result.scheduled = await enqueueDueScheduledRuns(options.db);

  for (const run of await store.listInterrupted(Date.now(), 50)) {
    const failed = await failWorkflowRunFromHost(
      store,
      run.id,
      Date.now(),
      "The run was interrupted: the server stopped while a step was running. Start it again.",
      ["running"],
    );
    if (failed) {
      result.interrupted += 1;
      await announceFailure(failed);
    }
  }

  const due = await store.listDue(Date.now(), options.limit ?? 50);
  for (const run of due) {
    if (Date.now() - startedAt > budgetMs) {
      result.deferred += 1;
      continue;
    }
    try {
      const moved = await options.runAs(
        { spaceId: run.spaceId, actorId: run.startedBy, startedVia: run.startedVia },
        () => continueDueWorkflowRun(liveDeps({ background: true }), run.id),
      );
      if (moved) result.continued += 1;
      else result.deferred += 1;
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "unknown error";
      const failed = await failWorkflowRunFromHost(
        store,
        run.id,
        Date.now(),
        `Could not continue as the person who started this run: ${message}`,
        ["queued", "waiting", "running"],
      );
      if (failed) {
        result.orphaned += 1;
        await announceFailure(failed);
      }
      console.error("[busabase] workflow run could not continue", run.id, error);
    }
  }

  try {
    result.purged = await store.purgeFinished(
      Date.now() - WORKFLOW_RUN_RETENTION_DAYS * DAY_MS,
      WORKFLOW_RUN_PURGE_BATCH,
    );
  } catch (error) {
    console.error("[busabase] workflow run retention sweep failed", error);
  }
  return result;
};

export type WorkflowHookResult =
  | { kind: "not_found" }
  | { kind: "busy" }
  | {
      kind: "accepted";
      runId: string;
      status: WorkflowRun["status"];
      /** What a step chose to answer with, when one did before the request ended. */
      response: WorkflowHookResponse | null;
    };

/**
 * A request to a webhook trigger's URL. Queues a run with the request as its
 * payload, then starts it right away as the person who saved the workflow in
 * Event mode, so a short workflow finishes inside the request and a step can
 * answer the caller. A run over the workflow's concurrency, or one that pauses,
 * carries on in the scheduler like any other.
 */
/** One request to a webhook trigger: which workflow, the token from its URL, and the request. */
export interface WorkflowHookArgs {
  workflowNodeId: string;
  token: string;
  request: WorkflowHookRequest;
}

export const receiveWorkflowHook = async (
  options: WorkflowHookArgs & {
    db: BusabaseDatabase;
    runAs: WorkflowRunAs;
    notify?: (event: BusabaseNotificationEvent) => void | Promise<void>;
  },
): Promise<WorkflowHookResult> => {
  const queued = await enqueueWorkflowHookRun(options.db, {
    workflowNodeId: options.workflowNodeId,
    token: options.token,
    request: options.request,
    now: new Date(),
  });
  if (queued.kind !== "queued") return queued;

  const store = createDbWorkflowRunStore(() => options.db);
  try {
    await options.runAs(
      { spaceId: queued.spaceId, actorId: queued.startedBy, startedVia: null },
      () => continueDueWorkflowRun(liveDeps({ background: true }), queued.runId),
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "unknown error";
    const failed = await failWorkflowRunFromHost(
      store,
      queued.runId,
      Date.now(),
      `Could not continue as the person who started this run: ${message}`,
      ["queued", "running"],
    );
    if (failed) {
      try {
        await options.notify?.(workflowRunFailedEvent(failed, null));
      } catch (notifyError) {
        console.error("[busabase] workflow run failure alert failed", failed.id, notifyError);
      }
    }
  }

  const run = await store.get(queued.runId);
  return {
    kind: "accepted",
    runId: queued.runId,
    status: run?.status ?? "queued",
    response: run ? pickWorkflowHookResponse(run.outputs) : null,
  };
};

/** For the hosts' webhook routes: read a request the same way the runtime stores it. */
export {
  buildWorkflowHookRequest,
  WORKFLOW_HOOK_MAX_BODY_BYTES,
  type WorkflowHookResponse,
} from "../utils/hook";

/** Headers on every answer: the URL is on the app's origin, so nothing in it may run. */
const HOOK_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; sandbox",
  "x-content-type-options": "nosniff",
};

const hookJson = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...HOOK_RESPONSE_HEADERS, "content-type": "application/json; charset=utf-8" },
  });

/**
 * The whole webhook route for a host: read the request (refusing one over
 * `WORKFLOW_HOOK_MAX_BODY_BYTES`), hand it to `receive`, and answer with what a
 * step chose, or `202 { runId, status }`.
 */
export const respondToWorkflowHook = async (
  request: Request,
  params: { workflowNodeId: string; token: string },
  receive: (args: WorkflowHookArgs) => Promise<WorkflowHookResult>,
): Promise<Response> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > WORKFLOW_HOOK_MAX_BODY_BYTES) {
    return hookJson(413, { error: "Request body is too large" });
  }
  const bodyText =
    request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > WORKFLOW_HOOK_MAX_BODY_BYTES) {
    return hookJson(413, { error: "Request body is too large" });
  }
  const result = await receive({
    workflowNodeId: params.workflowNodeId,
    token: params.token,
    request: buildWorkflowHookRequest({
      method: request.method,
      url: request.url,
      headers: request.headers.entries(),
      bodyText,
      receivedAt: new Date(),
    }),
  });
  if (result.kind === "not_found") return hookJson(404, { error: "Not found" });
  if (result.kind === "busy") {
    return hookJson(429, {
      error: "Too many runs are waiting for this workflow. Try again later.",
    });
  }
  if (result.response) {
    return new Response(result.response.body, {
      status: result.response.status,
      headers: { ...HOOK_RESPONSE_HEADERS, "content-type": result.response.contentType },
    });
  }
  return hookJson(202, { runId: result.runId, status: result.status });
};
