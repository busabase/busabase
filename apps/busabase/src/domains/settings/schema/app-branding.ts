/**
 * OSS-local white-label branding — a single-row table holding the operator's
 * custom product name, tagline/description and logo URL for the sidebar
 * top-left slot and the browser title.
 *
 * Like `cloud-connect.ts`, this is app-local instance config rather than a
 * domain concept shared with `busabase-core`, so it is registered only via
 * `apps/busabase/src/db/schema.ts` — `apps/busabase-cloud` never runs this
 * migration/table. Persisting it in the DB (rather than an env var or
 * localStorage) is what makes it survive on busabase-desktop.
 *
 * Every column is nullable: NULL/empty means "use the built-in default".
 */

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Single-row singleton — there is exactly one branding row per OSS instance. */
export const APP_BRANDING_ROW_ID = "local";

/**
 * Named without an `oss_` marker, matching its only sibling of this kind:
 * `busabase_cloud_connect` is also app-local and also absent from
 * `apps/busabase-cloud`. What keeps either table from being mistaken for a
 * shared one is that neither is defined in `busabase-core` — the cloud app
 * cannot import them even by accident, since it only registers core's schema.
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
