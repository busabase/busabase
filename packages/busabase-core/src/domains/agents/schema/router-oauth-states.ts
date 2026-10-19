import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One row per in-flight "Connect via ACPRouter" OAuth attempt (spec §8.1/8.2).
 *
 * Unlike the sibling Buda flow (which keeps its pending-authorization state in
 * a signed httpOnly cookie, never a DB row), this one is a dedicated table —
 * tasks.md 7.1 asks for it explicitly, and a DB row is what lets the signed
 * one-use `state` value be consumed exactly once via an atomic
 * `UPDATE ... WHERE status = 'pending' RETURNING` rather than relying on
 * cookie expiry alone, which a replayed callback request could otherwise race.
 *
 * `busabaseActorId`/`busabaseSpaceId` are the FROZEN actor/space at the
 * moment the flow started — task 8.2 re-verifies the signed-in actor still
 * matches this frozen pair (and is still a member of this frozen space)
 * before ever persisting a grant, specifically to catch a different actor
 * completing the callback than the one who started it.
 */
export const busabaseRouterOauthStates = pgTable(
  "busabase_router_oauth_states",
  {
    id: text("id").primaryKey(),
    busabaseActorId: text("busabase_actor_id").notNull(),
    busabaseSpaceId: text("busabase_space_id").notNull(),
    /** PKCE verifier sent to the token endpoint on callback; never logged. */
    pkceVerifier: text("pkce_verifier").notNull(),
    /** HMAC-signed, one-use nonce round-tripped through the ACPRouter consent page. */
    signedState: text("signed_state").notNull(),
    status: text("status").$type<"pending" | "consumed">().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date" }),
  },
  (table) => [uniqueIndex("busabase_router_oauth_states_signed_state_idx").on(table.signedState)],
);

export type RouterOauthStatePO = typeof busabaseRouterOauthStates.$inferSelect;
export type RouterOauthStateInsertPO = typeof busabaseRouterOauthStates.$inferInsert;
