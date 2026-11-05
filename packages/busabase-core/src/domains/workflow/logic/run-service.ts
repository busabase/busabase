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
import { getRecord } from "../../base/logic/queries";
import {
  createChangeRequest,
  createDeleteChangeRequest,
  createUpdateChangeRequest,
} from "../../base/logic/record-ops";
import { readRichNodeDocument } from "../../rich-node/handlers";
import { runFunction } from "../../webhook/logic/sandbox";
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
import { runWithoutWorkflowTriggers } from "./triggers";
import { sendWorkflowWebhook } from "./webhook-step";

const executeStoredFunction = async (
  spaceId: string,
  call: WorkflowFunctionCall,
): Promise<WorkflowFunctionCallResult> => {
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
  };
  const announceFailure = async (run: WorkflowRun) => {
    try {
      await options.notify?.(workflowRunFailedEvent(run, null));
    } catch (error) {
      console.error("[busabase] workflow run failure alert failed", run.id, error);
    }
  };

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
