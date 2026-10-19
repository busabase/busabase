import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { busabaseRouterGrants } from "./router-grants";

/**
 * One row per in-flight device enrollment under a grant (tasks.md 7.3,
 * design.md Decision 7 / 8.5) — tracks the mint→bridge→secret-registration
 * handshake for exactly one ACPRouter `enrollmentId` (the mint response's own
 * `machineId`/token id, same documented alias Task 4.4 established).
 *
 * `consumerSecretEncrypted` holds the ONE locally-generated consumer secret,
 * encrypted at rest, written durably BEFORE the hash is ever sent over HTTP
 * to ACPRouter's completion endpoint (task 8.5) — this is what makes a
 * crash between "generated secret" and "registered hash" recoverable: on
 * retry, the same encrypted secret is reused rather than a fresh one being
 * minted, so ACPRouter's idempotent same-hash retry (task 5.2) is actually
 * exercised instead of silently producing a second, orphaned secret.
 *
 * `status` tracks this row's own narrow state machine, independent of (but
 * informed by) ACPRouter's own `getGrantEnrollmentStatus` states:
 * - `pending`: secret not yet generated/claimed.
 * - `secret_claimed`: this row atomically claimed the right to generate the
 *   secret (task 8.5's atomic pending-row claim) — the encrypted secret is
 *   set in the same write.
 * - `registered`: the hash was successfully registered via task 5.2's
 *   completion endpoint.
 * - `connected`: a stable `busabaseRouterConnections` row now exists using
 *   this same secret; this pending row's job is done.
 * - `failed`: abandoned past the bridge-start deadline, mirroring the
 *   ACPRouter-side `bridgeDeadlineAt` concept (task 4.5) rather than
 *   inventing a second one here.
 */
export const busabaseRouterPendingEnrollments = pgTable(
  "busabase_router_pending_enrollments",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id")
      .notNull()
      .references(() => busabaseRouterGrants.id),
    acprouterEnrollmentId: text("acprouter_enrollment_id").notNull(),
    /** Set once the mint response reports a machine/agent correlation. */
    acprouterAgentId: text("acprouter_agent_id"),
    status: text("status")
      .$type<"pending" | "secret_claimed" | "registered" | "connected" | "failed">()
      .notNull()
      .default("pending"),
    consumerSecretEncrypted: text("consumer_secret_encrypted"),
    bridgeDeadlineAt: timestamp("bridge_deadline_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("busabase_router_pending_enrollments_grant_enrollment_idx").on(
      table.grantId,
      table.acprouterEnrollmentId,
    ),
    index("busabase_router_pending_enrollments_status_idx").on(table.status),
  ],
);

export type RouterPendingEnrollmentPO = typeof busabaseRouterPendingEnrollments.$inferSelect;
export type RouterPendingEnrollmentInsertPO = typeof busabaseRouterPendingEnrollments.$inferInsert;

/**
 * One row per fully-connected ACPRouter-backed agent (tasks.md 7.3) — a
 * **multi-row-per-grant** table, not a singleton: a single grant/space can
 * enroll several machines (task 8.8's "a grant with two enrolled machines
 * surfacing as two distinct connections"), each with its own stable
 * `vaultItemId` holding the same consumer secret this row was created with.
 *
 * `acprouterEnrollmentId` is kept here too (not just on the pending row,
 * which is deleted/superseded once connected) so `router-connection.ts` can
 * build `{url, authHeader}` and call the revoke endpoint without needing to
 * join back through a pending-enrollment row that may no longer exist.
 *
 * `pendingRevokedAt` (post-draft review fix) is set the instant a disconnect
 * is requested, BEFORE the ACPRouter-side network call — `resolveRouterConnectionLaunch`
 * refuses to launch while this is set, closing the TOCTOU gap where a
 * connection could still be launched for however long the remote revoke call
 * takes to complete. Retained when the remote call fails: disconnect can
 * be retried, but new sessions cannot use unresolved credentials.
 */
export const busabaseRouterConnections = pgTable(
  "busabase_router_connections",
  {
    id: text("id").primaryKey(),
    grantId: text("grant_id")
      .notNull()
      .references(() => busabaseRouterGrants.id),
    acprouterEnrollmentId: text("acprouter_enrollment_id").notNull(),
    acprouterAgentId: text("acprouter_agent_id").notNull(),
    agentSlug: text("agent_slug").notNull(),
    vaultItemId: text("vault_item_id").notNull(),
    pendingRevokedAt: timestamp("pending_revoked_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("busabase_router_connections_grant_enrollment_idx").on(
      table.grantId,
      table.acprouterEnrollmentId,
    ),
    index("busabase_router_connections_grant_idx").on(table.grantId),
  ],
);

export type RouterConnectionPO = typeof busabaseRouterConnections.$inferSelect;
export type RouterConnectionInsertPO = typeof busabaseRouterConnections.$inferInsert;
