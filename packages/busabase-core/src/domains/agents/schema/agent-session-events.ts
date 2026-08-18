import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busabaseAgentSessions } from "./agent-sessions";

/**
 * The transcript, append-only: every `session/update` the agent sent plus the
 * permission requests it made and how they were answered.
 *
 * Stored as one `payload` blob rather than a column per event variant. The
 * variants keep growing (ACP v1 and v2 disagree on `session/update`'s inner
 * shape and agents straddle both, and `permissionRequest`/`permissionResolved`
 * were added after the first pass), so a wide sparse table would be mostly
 * NULLs and would need a migration per new kind.
 *
 * **A row is not necessarily one emitted event.** Agents stream at token
 * granularity — one measured turn produced 26 events for a three-line haiku,
 * 15 of them single-token `agent_message_chunk`s — so writing one row per
 * `emit()` would be an INSERT per token against an embedded PGLite on the
 * desktop build. Chunks are coalesced at the turn boundary before they land
 * here (spec §7.5); `seq` therefore stays gap-free per session but does not
 * correspond 1:1 to the in-memory counter.
 */
export const busabaseAgentSessionEvents = pgTable(
  "busabase_agent_session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => busabaseAgentSessions.id, { onDelete: "cascade" }),
    /** Monotonic per session — what a reconnecting client passes as `afterSeq`. */
    seq: integer("seq").notNull(),
    kind: text("kind").$type<AgentSessionEventVO["kind"]>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    at: timestamp("at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Replay is "everything after seq N for this session", and the pair must be
    // unique or a resumed client could see a duplicate.
    uniqueIndex("busabase_agent_session_events_session_seq_idx").on(table.sessionId, table.seq),
    // Makes the §7.5 retention sweep a range scan instead of a table scan.
    // Borrowed from acprouter's equivalent table, which had it and this design
    // originally did not (§7.2).
    index("busabase_agent_session_events_at_idx").on(table.at),
  ],
);

export type AgentSessionEventPO = typeof busabaseAgentSessionEvents.$inferSelect;
export type AgentSessionEventInsertPO = typeof busabaseAgentSessionEvents.$inferInsert;
