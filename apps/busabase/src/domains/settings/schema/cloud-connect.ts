/**
 * OSS-local Cloud Connect state — a single-row table holding this local
 * instance's stable `tunnelId`, the configured Cloud URL, and (once connected)
 * the scoped tunnel-connect credential (`tcc_…`, minted by
 * `apps/busabase-cloud`'s `client_platform=tunnel` OAuth exchange).
 *
 * Deliberately NOT `busabase_vault_items` (Vault) — that's user-facing secrets
 * storage with a different threat model (see Local ↔ Cloud Tunnel spec,
 * OSS-side notes). This table is app-local instance config, not a domain
 * concept shared with `busabase-core` (so it's registered only via
 * `apps/busabase/src/db/schema.ts`, not `packages/busabase-core`'s schema —
 * `apps/busabase-cloud` never runs this migration/table).
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Single-row singleton — there is exactly one local instance per OSS server. */
export const CLOUD_CONNECT_ROW_ID = "local";

export const busabaseCloudConnect = pgTable("busabase_cloud_connect", {
  id: text("id").primaryKey().default(CLOUD_CONNECT_ROW_ID),
  /** Stable local tunnel identity, generated once and persisted across restarts. */
  tunnelId: text("tunnel_id").notNull(),
  /** Which Cloud instance to connect to — editable in Settings (self-hosted Cloud). */
  cloudUrl: text("cloud_url").notNull(),
  /** The origin (scheme+host+port) this OSS server was reached at when it last
   *  connected — needed to resume the relay client (register/ws) on boot,
   *  when there is no incoming request to read it from. */
  ossOrigin: text("oss_origin"),
  /** Scoped tunnel-connect credential (spec §5a) — null while disconnected. */
  credentialToken: text("credential_token"),
  credentialExpiresAt: timestamp("credential_expires_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export type BusabaseCloudConnectRow = typeof busabaseCloudConnect.$inferSelect;
export type NewBusabaseCloudConnectRow = typeof busabaseCloudConnect.$inferInsert;
