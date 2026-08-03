/**
 * White-label branding local state — DB access for the single
 * `busabase_app_branding` row. Mirrors `cloud-connect-store.ts`: every function
 * takes `db` first, this file is the ONLY place that touches the table, and it
 * imports nothing from React/Next so route handlers and `generateMetadata`
 * alike can call it.
 */
import "server-only";
import type { BusabaseDatabase as Database } from "busabase-core/context";
import { deleteBrandingLogoByUrl } from "busabase-core/domains/attachments/logic";
import { eq } from "drizzle-orm";
import {
  APP_BRANDING_ROW_ID,
  type BusabaseAppBrandingRow,
  busabaseAppBranding,
} from "../schema/app-branding";
import type { AppBrandingVO, UpdateAppBrandingDTO } from "../types/app-branding";

/** The "nothing customized" VO — also what a fresh instance reads. */
export const EMPTY_APP_BRANDING: AppBrandingVO = {
  name: null,
  description: null,
  logoUrl: null,
  updatedAt: null,
};

const toAppBrandingVO = (po: BusabaseAppBrandingRow): AppBrandingVO => ({
  name: po.name,
  description: po.description,
  logoUrl: po.logoUrl,
  updatedAt: po.updatedAt.toISOString(),
});

const readRow = async (db: Database): Promise<BusabaseAppBrandingRow | null> => {
  const [row] = await db
    .select()
    .from(busabaseAppBranding)
    .where(eq(busabaseAppBranding.id, APP_BRANDING_ROW_ID))
    .limit(1);
  return row ?? null;
};

/**
 * Read the branding VO. Never creates the row — an instance that has never
 * been branded should not pay a write on every page load, it just reads empty.
 */
export const getAppBranding = async (db: Database): Promise<AppBrandingVO> => {
  const row = await readRow(db);
  return row ? toAppBrandingVO(row) : EMPTY_APP_BRANDING;
};

/**
 * Same as `getAppBranding`, but tolerates a database that isn't reachable or
 * hasn't been migrated yet (first boot, `generateMetadata` on a cold install).
 * The page title is not worth a 500.
 */
export const getAppBrandingSafe = async (db: Database): Promise<AppBrandingVO> => {
  try {
    return await getAppBranding(db);
  } catch {
    return EMPTY_APP_BRANDING;
  }
};

/**
 * Upsert the singleton. A `null` field is stored as NULL, i.e. "reset this
 * field to the built-in default" — clearing the input in Settings is the reset
 * affordance.
 *
 * Replacing or removing the logo also cleans up the previous one: nothing in
 * this repo garbage-collects orphaned attachments, so every replacement would
 * otherwise leak a row plus a stored object forever. The cleanup runs AFTER the
 * save and is best-effort — an operator's branding must never fail to save
 * because some stale bytes couldn't be tidied up.
 */
export const updateAppBranding = async (
  db: Database,
  input: UpdateAppBrandingDTO,
): Promise<AppBrandingVO> => {
  const previousLogoUrl = (await readRow(db))?.logoUrl ?? null;
  const now = new Date();
  const [row] = await db
    .insert(busabaseAppBranding)
    .values({
      id: APP_BRANDING_ROW_ID,
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: busabaseAppBranding.id,
      set: {
        name: input.name,
        description: input.description,
        logoUrl: input.logoUrl,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error("Failed to save the branding row.");

  // Only when the logo actually changed. `deleteBrandingLogoByUrl` is itself
  // conservative — it deletes nothing unless the outgoing URL is the public URL
  // of an attachment written by the branding uploader — so `/icon.svg` or an
  // externally hosted logo passes through it untouched.
  if (previousLogoUrl && previousLogoUrl !== row.logoUrl) {
    try {
      await deleteBrandingLogoByUrl(db, previousLogoUrl);
    } catch (error) {
      console.warn("[branding] couldn't clean up the previous logo:", error);
    }
  }

  return toAppBrandingVO(row);
};
