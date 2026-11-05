import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { WorkflowDocument } from "busabase-contract/domains/rich-node/types";
import {
  isWorkflowRecordEvent,
  type WorkflowRecordEvent,
} from "busabase-contract/domains/workflow/run";
import { and, eq, isNull, or } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseNodes } from "../../../db/schema";
import { id } from "../../../logic/kernel";
import { busabaseWorkflowRuns, type WorkflowRunInsertPO } from "../schema/workflow-runs";
import { busabaseWorkflowTriggers } from "../schema/workflow-triggers";

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
  const rows = args.document.nodes.flatMap((node) =>
    node.kind === "trigger" && isWorkflowRecordEvent(node.eventName)
      ? [
          {
            id: id("wft"),
            spaceId: args.spaceId,
            workflowNodeId: args.workflowNodeId,
            triggerNodeId: node.id,
            eventType: node.eventName,
            baseId: node.baseId.trim() || null,
            armedBy: args.armedBy,
            createdAt: args.now,
          },
        ]
      : [],
  );
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
  },
): Promise<number> => {
  if (args.recordIds.length === 0 || suppression.getStore()) return 0;
  try {
    const triggers = await db
      .select({
        workflowNodeId: busabaseWorkflowTriggers.workflowNodeId,
        triggerNodeId: busabaseWorkflowTriggers.triggerNodeId,
        armedBy: busabaseWorkflowTriggers.armedBy,
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

    const now = new Date();
    const rows: WorkflowRunInsertPO[] = [];
    for (const trigger of triggers) {
      for (const recordId of new Set(args.recordIds)) {
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
