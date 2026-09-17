import type { AgentSessionStatus, AgentTransport } from "busabase-contract/domains/agents/types";
import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    /**
     * Cross-worker turn ownership (PUL-223 follow-up). `leaseOwnerId` is null
     * and `leaseExpiresAt` is null when no worker holds an active turn; both
     * are set atomically with `status: "busy"` by `acquireSessionLease`.
     *
     * `leaseFencingToken` is never reset, only ever incremented — a write
     * carrying a token that is not the row's *current* value is from a
     * worker that has since been superseded (crashed, or simply outlasted by
     * a takeover after its lease expired) and must be rejected. This is what
     * makes takeover after a crash safe: the old owner's in-flight writes
     * cannot silently corrupt state, even though ACP v1 gives us no way to
     * ask the agent to resend/discard that abandoned turn.
     */
    leaseOwnerId: text("lease_owner_id"),
    leaseFencingToken: bigint("lease_fencing_token", { mode: "number" }).notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { mode: "date" }),
    /**
     * Durable mirror of `LiveSession.modelOption` (PUL-246), for
     * `remote-websocket` sessions only. `remote-websocket` agents outlive the
     * request and can be reattached from ANY worker (PUL-223), so the model
     * selector must not live only in one worker's in-memory map — a list
     * request served by a non-owning worker would otherwise see the same
     * durable row with no selector at all. Untyped `jsonb` at rest: this
     * column is read back through `AgentSessionModelOptionVOSchema.safeParse`
     * (see `agent-session-store.ts#toVO`), never trusted verbatim, so a
     * malformed or stale shape degrades to `null` instead of throwing.
     */
    modelOption: jsonb("model_option"),
  },
  (table) => [
    // Every read is "this space's sessions, newest first" (the List and Detail
    // views), so the ordering column belongs in the index rather than a sort.
    index("busabase_agent_sessions_space_activity_idx").on(table.spaceId, table.lastActivityAt),
  ],
);

export type AgentSessionPO = typeof busabaseAgentSessions.$inferSelect;
export type AgentSessionInsertPO = typeof busabaseAgentSessions.$inferInsert;
