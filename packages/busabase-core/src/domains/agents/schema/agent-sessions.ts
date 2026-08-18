import type { AgentSessionStatus, AgentTransport } from "busabase-contract/domains/agents/types";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

/**
 * One row per ACP `session/new`.
 *
 * What this is *for* differs by transport, and the difference is load-bearing
 * (spec §7.1): for `local-subprocess` this row is the only durable record that
 * the session ever existed — the agent lived in a child process that dies with
 * the server, and there is nothing to re-query afterwards. For
 * `remote-websocket` the agent outlives us, so the row is closer to an index
 * over state whose authority is remote, and `acpSessionId` is what makes
 * `session/load` possible against it.
 *
 * Status uses the contract's own vocabulary via a **type-only** import: the
 * enum already lives in `busabase-contract` (the VO needs it), and duplicating
 * it here would invite the two to drift silently. Sibling schema files declare
 * their unions locally only because those unions have no contract counterpart
 * — the import is erased at compile time and pulls nothing into any bundle, so
 * the "schema is PO-only" rule is untouched.
 */
export const busabaseAgentSessions = pgTable(
  "busabase_agent_sessions",
  {
    /** Busabase's own id (`ags_…`), not the agent's ACP session id. */
    id: text("id").primaryKey(),
    spaceId: spaceIdColumn(),
    /** Cloud's authenticated actor; null on OSS, which has no multi-tenant actor. */
    actorId: text("actor_id"),
    slug: text("slug").notNull(),
    agentName: text("agent_name").notNull(),
    transport: text("transport").$type<AgentTransport>().notNull(),
    status: text("status").$type<AgentSessionStatus>().notNull(),
    /** The AGENT's own session id — required for `session/load` on remote transports. */
    acpSessionId: text("acp_session_id"),
    /** Set when status is `failed`; surfaced verbatim to the user. */
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at", { mode: "date" }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { mode: "date" }),
  },
  (table) => [
    // Every read is "this space's sessions, newest first" (the List and Detail
    // views), so the ordering column belongs in the index rather than a sort.
    index("busabase_agent_sessions_space_activity_idx").on(table.spaceId, table.lastActivityAt),
  ],
);

export type AgentSessionPO = typeof busabaseAgentSessions.$inferSelect;
export type AgentSessionInsertPO = typeof busabaseAgentSessions.$inferInsert;
