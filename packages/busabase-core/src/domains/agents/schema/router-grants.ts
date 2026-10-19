import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per completed "Connect via ACPRouter" consent (spec §8.2, tasks.md
 * 7.2) — the durable record that lets Busabase mint/poll/revoke against a
 * specific ACPRouter grant without re-running the OAuth dance each time.
 *
 * The authenticated grant-info response supplies issuer, clientId, remote
 * grantId, userId and spaceId. OAuth completion validates issuer/client and
 * stores that binding alongside the encrypted token pair in tokenVaultItemId;
 * this table exposes only the nonsecret space identity needed by the UI.
 * Every downstream request authenticates with a bearer credential; Router
 * derives the grant server-side, never from a browser-supplied remote id.
 *
 * One row per completed consent, no tuple dedup — re-authorizing creates a
 * new row with a new `id`, mirroring the "fresh grantId per consent" rule
 * task 12a.1 requires on the ACPRouter side.
 */
export const busabaseRouterGrants = pgTable(
  "busabase_router_grants",
  {
    id: text("id").primaryKey(),
    busabaseActorId: text("busabase_actor_id").notNull(),
    busabaseSpaceId: text("busabase_space_id").notNull(),
    acprouterSpaceId: text("acprouter_space_id").notNull(),
    acprouterSpaceName: text("acprouter_space_name").notNull(),
    /** Vault row holding the encrypted `{accessToken, refreshToken, expiresAt}` triple. */
    tokenVaultItemId: text("token_vault_item_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date" }),
  },
  (table) => [index("busabase_router_grants_space_idx").on(table.busabaseSpaceId)],
);

export type RouterGrantPO = typeof busabaseRouterGrants.$inferSelect;
export type RouterGrantInsertPO = typeof busabaseRouterGrants.$inferInsert;
