import type {
  AgentSessionCommandKind,
  AgentSessionCommandState,
} from "busabase-contract/domains/agents/types";
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";
import { busabaseAgentSessions } from "./agent-sessions";

/** Durable authorized intent; transport credentials are never stored here. */
export const busabaseAgentSessionCommands = pgTable(
  "busabase_agent_session_commands",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => busabaseAgentSessions.id, { onDelete: "cascade" }),
    spaceId: spaceIdColumn(),
    actorId: text("actor_id"),
    commandId: text("command_id").notNull(),
    kind: text("kind").$type<AgentSessionCommandKind>().notNull(),
    state: text("state").$type<AgentSessionCommandState>().notNull().default("queued"),
    bindingGeneration: bigint("binding_generation", { mode: "number" }).notNull(),
    contentDigest: text("content_digest").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    presentation: jsonb("presentation").$type<Record<string, unknown>>(),
    targetCommandId: text("target_command_id"),
    claimingEpoch: bigint("claiming_epoch", { mode: "number" }),
    receipt: jsonb("receipt").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("busabase_agent_session_commands_identity_idx").on(
      table.sessionId,
      table.commandId,
    ),
    index("busabase_agent_session_commands_pending_idx").on(
      table.sessionId,
      table.state,
      table.createdAt,
    ),
  ],
);
export type AgentSessionCommandPO = typeof busabaseAgentSessionCommands.$inferSelect;
export type AgentSessionCommandInsertPO = typeof busabaseAgentSessionCommands.$inferInsert;
