import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

export type WorkflowRunStatusPO =
  | "queued"
  | "running"
  | "waiting"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * One execution of a workflow graph. The row IS the run: every step output,
 * the pause, and the cursor live here, so a Wait survives a restart and any
 * replica can resume it.
 *
 * `leaseUntil` replaces an in-process lock. A worker claims a run with a
 * conditional UPDATE (`lease_until IS NULL OR lease_until < now`) before it
 * advances, and clears it when it stores the result. A crashed worker's lease
 * simply expires.
 */
export const busabaseWorkflowRuns = pgTable(
  "busabase_workflow_runs",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    workflowNodeId: text("workflow_node_id").notNull(),
    status: text("status").$type<WorkflowRunStatusPO>().notNull(),
    trigger: text("trigger").$type<"manual" | "event">().notNull(),
    /** Actor the run acts as when no request is driving it (scheduler, event). */
    startedBy: text("started_by").notNull(),
    /** The agent credential behind `startedBy`, when an agent started the run. */
    startedVia: jsonb("started_via").$type<Record<string, unknown> | null>(),
    cancelledBy: text("cancelled_by"),
    /** Next step to run. For a queued event run, the trigger it starts from. */
    cursorNodeId: text("cursor_node_id"),
    previousNodeId: text("previous_node_id"),
    recordId: text("record_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull(),
    pause: jsonb("pause").$type<Record<string, unknown> | null>(),
    /** Mirrors `pause.resumeAt` for a Wait so the scheduler can index it. */
    resumeAt: timestamp("resume_at", { mode: "date" }),
    error: text("error"),
    leaseUntil: timestamp("lease_until", { mode: "date" }),
    startedAt: timestamp("started_at", { mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
  },
  (table) => [
    // The canvas run list: newest runs of one workflow.
    index("busabase_workflow_runs_space_workflow_started_idx").on(
      table.spaceId,
      table.workflowNodeId,
      table.startedAt,
    ),
    // The scheduler sweep, across spaces: queued runs and elapsed Waits.
    index("busabase_workflow_runs_status_resume_idx").on(table.status, table.resumeAt),
    // The retention sweep: finished runs past their keep-until.
    index("busabase_workflow_runs_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

export type WorkflowRunPO = typeof busabaseWorkflowRuns.$inferSelect;
export type WorkflowRunInsertPO = typeof busabaseWorkflowRuns.$inferInsert;
