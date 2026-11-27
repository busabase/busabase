/**
 * White-label branding — a single-row table holding the operator's custom
 * product name, tagline/description and logo URL.
 *
 * Shared by both deployments that brand themselves at runtime:
 * - the open-source app (`apps/busabase`), where every instance may brand
 *   itself from Settings → Branding (sidebar top-left slot + browser title);
 * - Busabase Premium, the self-hosted build of the Busabase Cloud app, where a
 *   system admin edits the same row and it only takes effect while the
 *   installed licence carries the `white_label` feature.
 * Busabase Cloud (the hosted SaaS) and build-time OEM profiles never read it.
 *
 * Persisting it in the DB (rather than an env var or localStorage) is what
 * makes it survive restarts, apply to every replica, and work on
 * busabase-desktop.
 *
 * Every column is nullable: NULL/empty means "use the built-in default".
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Single-row singleton — there is exactly one branding row per OSS instance. */
export const APP_BRANDING_ROW_ID = "local";

/**
 * Named without an `oss_` marker even though it started out OSS-only: it now
 * lives in `busabase-core`'s schema, so every app that registers core's schema
 * (the OSS app and Busabase Cloud/Premium) creates the same table.
 */
export const busabaseAppBranding = pgTable("busabase_app_branding", {
  id: text("id").primaryKey().default(APP_BRANDING_ROW_ID),
  /** Custom product name shown in the sidebar + browser title. NULL = default. */
  name: text("name"),
  /** Custom one-line description shown under the name. NULL = default. */
  description: text("description"),
  /** Custom logo URL (absolute or app-relative). NULL = default `/icon.svg`. */
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export type BusabaseAppBrandingRow = typeof busabaseAppBranding.$inferSelect;
export type NewBusabaseAppBrandingRow = typeof busabaseAppBranding.$inferInsert;
