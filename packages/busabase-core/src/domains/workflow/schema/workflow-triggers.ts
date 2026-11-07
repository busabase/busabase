import type { WorkflowSchedule } from "busabase-contract/domains/rich-node/types";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

/**
 * Which workflows a record event starts. A projection of the saved graphs:
 * rewritten for one workflow every time its document merges, so a record
 * merge asks one indexed question instead of opening every workflow file.
 *
 * Only `executionMode: "event"` workflows have rows, one per trigger step
 * whose `eventName` is a record event, `schedule`, or `webhook`. `armedBy` is the actor
 * who merged that version; the runs it starts act as them.
 */
export const busabaseWorkflowTriggers = pgTable(
  "busabase_workflow_triggers",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    workflowNodeId: text("workflow_node_id").notNull(),
    triggerNodeId: text("trigger_node_id").notNull(),
    eventType: text("event_type")
      .$type<"record.created" | "record.updated" | "schedule" | "webhook">()
      .notNull(),
    /** Null: any Base in the space. */
    baseId: text("base_id"),
    /** The trigger's field filter or schedule. Null: every event of the type. */
    config: jsonb("config").$type<WorkflowTriggerConfig>(),
    /** Schedule rows only: when the next run is due. The scheduler moves it forward as it starts one. */
    nextRunAt: timestamp("next_run_at", { mode: "date" }),
    armedBy: text("armed_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("busabase_workflow_triggers_space_event_idx").on(table.spaceId, table.eventType),
    index("busabase_workflow_triggers_workflow_idx").on(table.workflowNodeId),
    index("busabase_workflow_triggers_due_idx").on(table.eventType, table.nextRunAt),
  ],
);

export type WorkflowTriggerConfig = {
  fieldSlug?: string;
  toValue?: string;
  schedule?: WorkflowSchedule;
  /** Webhook rows: the secret part of the trigger's URL. */
  hookToken?: string;
};

export type WorkflowTriggerPO = typeof busabaseWorkflowTriggers.$inferSelect;
export type WorkflowTriggerInsertPO = typeof busabaseWorkflowTriggers.$inferInsert;
