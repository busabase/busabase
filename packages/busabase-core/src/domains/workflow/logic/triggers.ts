import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";
import {
  type WorkflowDocument,
  WorkflowScheduleSchema,
} from "busabase-contract/domains/rich-node/types";
import {
  isWorkflowRecordEvent,
  WORKFLOW_SCHEDULE_EVENT,
  WORKFLOW_WEBHOOK_EVENT,
  type WorkflowRecordEvent,
} from "busabase-contract/domains/workflow/run";
import { and, asc, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseCommits, busabaseNodes, busabaseRecords } from "../../../db/schema";
import { id } from "../../../logic/kernel";
import { busabaseWorkflowRuns, type WorkflowRunInsertPO } from "../schema/workflow-runs";
import {
  busabaseWorkflowTriggers,
  type WorkflowTriggerConfig,
  type WorkflowTriggerInsertPO,
} from "../schema/workflow-triggers";
import { WORKFLOW_HOOK_MAX_QUEUED, type WorkflowHookRequest } from "../utils/hook";
import { nextScheduledRun } from "../utils/schedule";
import { fieldChangeMatches } from "../utils/trigger-filter";

/**
 * Rewrite one workflow's event subscriptions from the graph that just merged.
 *
 * Called inside the merge transaction, so the subscriptions change exactly
 * when the saved graph does. Manual-mode graphs, and triggers whose event is
 * not a record event, leave no rows. `armedBy` is whoever merged this version:
 * the runs it starts act as them.
 */
export const syncWorkflowTriggers = async (
  db: BusabaseDatabase,
  args: {
    spaceId: string;
    workflowNodeId: string;
    document: WorkflowDocument;
    armedBy: string;
    now: Date;
  },
): Promise<void> => {
  await db
    .delete(busabaseWorkflowTriggers)
    .where(eq(busabaseWorkflowTriggers.workflowNodeId, args.workflowNodeId));
  if (args.document.settings.executionMode !== "event") return;
  const rows = args.document.nodes.flatMap((node): WorkflowTriggerInsertPO[] => {
    if (node.kind !== "trigger") return [];
    const row = {
      id: id("wft"),
      spaceId: args.spaceId,
      workflowNodeId: args.workflowNodeId,
      triggerNodeId: node.id,
      armedBy: args.armedBy,
      createdAt: args.now,
    };
    if (isWorkflowRecordEvent(node.eventName)) {
      const fieldSlug = node.fieldSlug?.trim() ?? "";
      const config: WorkflowTriggerConfig | null = fieldSlug
        ? { fieldSlug, ...(node.toValue ? { toValue: node.toValue } : {}) }
        : null;
      return [
        {
          ...row,
          eventType: node.eventName,
          baseId: node.baseId.trim() || null,
          config,
          nextRunAt: null,
        },
      ];
    }
    if (node.eventName === WORKFLOW_SCHEDULE_EVENT) {
      const schedule = WorkflowScheduleSchema.parse(node.schedule ?? {});
      return [
        {
          ...row,
          eventType: WORKFLOW_SCHEDULE_EVENT,
          baseId: null,
          config: { schedule },
          nextRunAt: nextScheduledRun(schedule, args.now),
        },
      ];
    }
    if (node.eventName === WORKFLOW_WEBHOOK_EVENT && node.hookToken) {
      return [
        {
          ...row,
          eventType: WORKFLOW_WEBHOOK_EVENT,
          baseId: null,
          config: { hookToken: node.hookToken },
          nextRunAt: null,
        },
      ];
    }
    return [];
  });
  if (rows.length > 0) await db.insert(busabaseWorkflowTriggers).values(rows);
};

const INSERT_CHUNK = 500;

const suppression = new AsyncLocalStorage<true>();

/**
 * Run `fn` so the record changes it merges queue no workflow runs. A workflow
 * step that edits the record it was started for would otherwise start the
 * workflow again, and again. Only changes that merge inside `fn` are covered:
 * a person approving the same change later is an ordinary edit.
 */
export const runWithoutWorkflowTriggers = <T>(fn: () => Promise<T>): Promise<T> =>
  suppression.run(true, fn);

/**
 * Queue one run per (matching trigger × record) for a record event. The
 * scheduler starts them as the trigger's `armedBy`. Costs one indexed query
 * when no workflow listens, which is the common case for a bulk import.
 *
 * Never throws: a workflow problem must not fail the record merge that
 * caused it. Returns how many runs were queued.
 */
export const enqueueWorkflowRunsForRecordEvent = async (
  db: BusabaseDatabase,
  args: {
    spaceId: string;
    baseId: string | null;
    eventType: WorkflowRecordEvent;
    recordIds: readonly string[];
    changeRequestId: string;
    /**
     * For `record.updated`: each record's head before this merge, so a trigger
     * that watches one field can tell whether that field changed. A record
     * missing here (and every created record) counts as having had no values.
     */
    previousHeadCommitIds?: ReadonlyMap<string, string>;
  },
): Promise<number> => {
  if (args.recordIds.length === 0 || suppression.getStore()) return 0;
  try {
    const triggers = await db
      .select({
        workflowNodeId: busabaseWorkflowTriggers.workflowNodeId,
        triggerNodeId: busabaseWorkflowTriggers.triggerNodeId,
        armedBy: busabaseWorkflowTriggers.armedBy,
        config: busabaseWorkflowTriggers.config,
      })
      .from(busabaseWorkflowTriggers)
      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseWorkflowTriggers.workflowNodeId))
      .where(
        and(
          eq(busabaseWorkflowTriggers.spaceId, args.spaceId),
          eq(busabaseWorkflowTriggers.eventType, args.eventType),
          args.baseId
            ? or(
                isNull(busabaseWorkflowTriggers.baseId),
                eq(busabaseWorkflowTriggers.baseId, args.baseId),
              )
            : isNull(busabaseWorkflowTriggers.baseId),
          isNull(busabaseNodes.archivedAt),
          isNull(busabaseNodes.deletedAt),
        ),
      );
    if (triggers.length === 0) return 0;

    const recordIds = [...new Set(args.recordIds)];
    const values = triggers.some((trigger) => trigger.config?.fieldSlug)
      ? await loadFieldValues(db, recordIds, args.previousHeadCommitIds)
      : null;

    const now = new Date();
    const rows: WorkflowRunInsertPO[] = [];
    for (const trigger of triggers) {
      for (const recordId of recordIds) {
        const fieldSlug = trigger.config?.fieldSlug;
        if (fieldSlug && values) {
          const record = values.get(recordId);
          if (
            !fieldChangeMatches({
              before: record?.before?.[fieldSlug],
              after: record?.after?.[fieldSlug],
              toValue: trigger.config?.toValue ?? "",
            })
          ) {
            continue;
          }
        }
        rows.push({
          id: id("wfr"),
          spaceId: args.spaceId,
          workflowNodeId: trigger.workflowNodeId,
          status: "queued",
          trigger: "event",
          startedBy: trigger.armedBy,
          cursorNodeId: trigger.triggerNodeId,
          previousNodeId: null,
          recordId,
          payload: {
            event: args.eventType,
            recordId,
            baseId: args.baseId,
            changeRequestId: args.changeRequestId,
          },
          outputs: {},
          pause: null,
          resumeAt: null,
          error: null,
          leaseUntil: null,
          startedAt: now,
          updatedAt: now,
        });
      }
    }
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      await db.insert(busabaseWorkflowRuns).values(rows.slice(start, start + INSERT_CHUNK));
    }
    return rows.length;
  } catch (error) {
    console.error("[busabase] queueing workflow runs for a record event failed", error);
    return 0;
  }
};

/** Each record's field values before and after the merge, read from their head commits. */
const loadFieldValues = async (
  db: BusabaseDatabase,
  recordIds: readonly string[],
  previousHeadCommitIds: ReadonlyMap<string, string> | undefined,
) => {
  const heads = await db
    .select({ id: busabaseRecords.id, headCommitId: busabaseRecords.headCommitId })
    .from(busabaseRecords)
    .where(inArray(busabaseRecords.id, [...recordIds]));
  const commitIds = [
    ...new Set([
      ...heads.map((head) => head.headCommitId),
      ...recordIds.flatMap((recordId) => {
        const previous = previousHeadCommitIds?.get(recordId);
        return previous ? [previous] : [];
      }),
    ]),
  ];
  const commits =
    commitIds.length > 0
      ? await db
          .select({ id: busabaseCommits.id, payload: busabaseCommits.payload })
          .from(busabaseCommits)
          .where(inArray(busabaseCommits.id, commitIds))
      : [];
  const payloadById = new Map(commits.map((commit) => [commit.id, commit.payload]));
  const headById = new Map(heads.map((head) => [head.id, head.headCommitId]));
  return new Map(
    recordIds.map((recordId) => {
      const previous = previousHeadCommitIds?.get(recordId);
      const current = headById.get(recordId);
      return [
        recordId,
        {
          before: previous ? payloadById.get(previous) : undefined,
          after: current ? payloadById.get(current) : undefined,
        },
      ] as const;
    }),
  );
};

const SCHEDULE_BATCH = 100;

/**
 * Queue a run for every schedule that is due, and move each one to its next
 * slot. Called on every scheduler tick before due runs are processed.
 *
 * Several replicas tick at once: a schedule is claimed by moving `nextRunAt`
 * only if it still holds the value that was read, so exactly one replica
 * queues the run. A tick that comes late queues one run, not one per missed
 * slot, and the next slot is counted from now. Never throws.
 */
export const enqueueDueScheduledRuns = async (
  db: BusabaseDatabase,
  now: Date = new Date(),
): Promise<number> => {
  try {
    const due = await db
      .select({
        id: busabaseWorkflowTriggers.id,
        spaceId: busabaseWorkflowTriggers.spaceId,
        workflowNodeId: busabaseWorkflowTriggers.workflowNodeId,
        triggerNodeId: busabaseWorkflowTriggers.triggerNodeId,
        armedBy: busabaseWorkflowTriggers.armedBy,
        config: busabaseWorkflowTriggers.config,
        nextRunAt: busabaseWorkflowTriggers.nextRunAt,
      })
      .from(busabaseWorkflowTriggers)
      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseWorkflowTriggers.workflowNodeId))
      .where(
        and(
          eq(busabaseWorkflowTriggers.eventType, WORKFLOW_SCHEDULE_EVENT),
          lte(busabaseWorkflowTriggers.nextRunAt, now),
          isNull(busabaseNodes.archivedAt),
          isNull(busabaseNodes.deletedAt),
        ),
      )
      .orderBy(asc(busabaseWorkflowTriggers.nextRunAt))
      .limit(SCHEDULE_BATCH);

    let queued = 0;
    for (const trigger of due) {
      const dueAt = trigger.nextRunAt;
      if (!dueAt) continue;
      const schedule = WorkflowScheduleSchema.parse(trigger.config?.schedule ?? {});
      // Claim and queue together: a failed insert must not lose the slot.
      const didQueue = await db.transaction(async (tx) => {
        const claimed = await tx
          .update(busabaseWorkflowTriggers)
          .set({ nextRunAt: nextScheduledRun(schedule, now) })
          .where(
            and(
              eq(busabaseWorkflowTriggers.id, trigger.id),
              eq(busabaseWorkflowTriggers.nextRunAt, dueAt),
            ),
          )
          .returning({ id: busabaseWorkflowTriggers.id });
        if (claimed.length === 0) return false;
        await tx.insert(busabaseWorkflowRuns).values({
          id: id("wfr"),
          spaceId: trigger.spaceId,
          workflowNodeId: trigger.workflowNodeId,
          status: "queued",
          trigger: "event",
          startedBy: trigger.armedBy,
          cursorNodeId: trigger.triggerNodeId,
          previousNodeId: null,
          recordId: null,
          payload: { event: WORKFLOW_SCHEDULE_EVENT, scheduledFor: dueAt.toISOString() },
          outputs: {},
          pause: null,
          resumeAt: null,
          error: null,
          leaseUntil: null,
          startedAt: now,
          updatedAt: now,
        });
        return true;
      });
      if (didQueue) queued += 1;
    }
    return queued;
  } catch (error) {
    console.error("[busabase] queueing scheduled workflow runs failed", error);
    return 0;
  }
};

const sameToken = (expected: string | undefined, given: string): boolean => {
  if (!expected) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(given);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Queue a run for a request to a webhook trigger's URL. `not_found` covers a
 * wrong token, a workflow in Manual mode, and an archived one alike, so the
 * caller learns nothing about which. `busy` when the workflow already has
 * `WORKFLOW_HOOK_MAX_QUEUED` runs waiting, so a flood of requests cannot pile
 * up without bound.
 */
export const enqueueWorkflowHookRun = async (
  db: BusabaseDatabase,
  args: { workflowNodeId: string; token: string; request: WorkflowHookRequest; now: Date },
): Promise<
  | { kind: "not_found" }
  | { kind: "busy" }
  | { kind: "queued"; runId: string; spaceId: string; startedBy: string }
> => {
  const triggers = await db
    .select({
      spaceId: busabaseWorkflowTriggers.spaceId,
      triggerNodeId: busabaseWorkflowTriggers.triggerNodeId,
      armedBy: busabaseWorkflowTriggers.armedBy,
      config: busabaseWorkflowTriggers.config,
    })
    .from(busabaseWorkflowTriggers)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseWorkflowTriggers.workflowNodeId))
    .where(
      and(
        eq(busabaseWorkflowTriggers.workflowNodeId, args.workflowNodeId),
        eq(busabaseWorkflowTriggers.eventType, WORKFLOW_WEBHOOK_EVENT),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    );
  const trigger = triggers.find((row) => sameToken(row.config?.hookToken, args.token));
  if (!trigger) return { kind: "not_found" };

  const [queued] = await db
    .select({ value: count() })
    .from(busabaseWorkflowRuns)
    .where(
      and(
        eq(busabaseWorkflowRuns.workflowNodeId, args.workflowNodeId),
        eq(busabaseWorkflowRuns.status, "queued"),
      ),
    );
  if ((queued?.value ?? 0) >= WORKFLOW_HOOK_MAX_QUEUED) return { kind: "busy" };

  const runId = id("wfr");
  await db.insert(busabaseWorkflowRuns).values({
    id: runId,
    spaceId: trigger.spaceId,
    workflowNodeId: args.workflowNodeId,
    status: "queued",
    trigger: "event",
    startedBy: trigger.armedBy,
    cursorNodeId: trigger.triggerNodeId,
    previousNodeId: null,
    recordId: null,
    payload: { event: WORKFLOW_WEBHOOK_EVENT, request: args.request },
    outputs: {},
    pause: null,
    resumeAt: null,
    error: null,
    leaseUntil: null,
    startedAt: args.now,
    updatedAt: args.now,
  });
  return { kind: "queued", runId, spaceId: trigger.spaceId, startedBy: trigger.armedBy };
};
