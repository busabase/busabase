import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

/**
 * Which workflows a record event starts. A projection of the saved graphs:
 * rewritten for one workflow every time its document merges, so a record
 * merge asks one indexed question instead of opening every workflow file.
 *
 * Only `executionMode: "event"` workflows have rows, one per trigger step
 * whose `eventName` is a record event. `armedBy` is the actor who merged that
 * version; event runs act as them.
 */
export const busabaseWorkflowTriggers = pgTable(
  "busabase_workflow_triggers",
  {
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    workflowNodeId: text("workflow_node_id").notNull(),
    triggerNodeId: text("trigger_node_id").notNull(),
    eventType: text("event_type").$type<"record.created" | "record.updated">().notNull(),
    /** Null: any Base in the space. */
    baseId: text("base_id"),
    armedBy: text("armed_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull(),
  },
  (table) => [
    index("busabase_workflow_triggers_space_event_idx").on(table.spaceId, table.eventType),
    index("busabase_workflow_triggers_workflow_idx").on(table.workflowNodeId),
  ],
);

export type WorkflowTriggerPO = typeof busabaseWorkflowTriggers.$inferSelect;
