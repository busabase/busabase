import type { InvalidCmsRecordIssue } from "../content";

/** Next data-cache `revalidate` used when an app does not override it. */
export const DEFAULT_CMS_REVALIDATE_SECONDS = 300;

/**
 * The four Base slugs used ONLY when `BUSABASE_CMS_FOLDER_ID` is unset. Without a Folder id,
 * `createBusabaseCms` otherwise falls back to the SDK's own generic, SHARED default Base slugs
 * (busabase-cms-posts / -pages / -categories / -tags), which would silently mix content with
 * any other app pointed at the same Busabase space without a Folder id configured — so an app
 * that wants its own Bases MUST pass its own app-prefixed slugs here.
 *
 * Each slug can still be overridden at deploy time by `BUSABASE_CMS_{POSTS,PAGES,CATEGORIES,
 * TAGS}_BASE_SLUG`; what is configured here is only the default.
 */
export interface CmsIntegrationBaseSlugs {
  posts: string;
  pages: string;
  categories: string;
  tags: string;
}

export interface CmsIntegrationCacheTags {
  posts?: string[];
  pages?: string[];
  categories?: string[];
  tags?: string[];
}

export interface CmsIntegrationCacheConfig {
  /** Seconds; `false` disables time-based revalidation. Defaults to 300. */
  revalidate?: number | false;
  /**
   * `revalidateTag` targets per collection. Defaults to
   * `["<cacheNamespace>:cms-<collection>"]`.
   */
  tags?: CmsIntegrationCacheTags;
}

export interface CmsIntegrationConfig {
  /** Human-readable app name, used only in degrade-safe warning log labels (e.g. "ProductReady"). */
  appLabel: string;
  /**
   * Stable, unique-per-app slug (e.g. "productready", "sandock-cloud", "busabase-cloud").
   *
   * This is the first discriminator in the Next data-cache key prefix and the default
   * `revalidateTag` namespace. It exists so that two apps deployed against the SAME Busabase
   * host + space can never read each other's cached CMS entries, no matter how their Folder id
   * or Base slugs are (mis)configured.
   */
  cacheNamespace: string;
  supportedLocales: readonly string[];
  defaultLocale: string;
  /**
   * Caller-owned profile label (see src/schema.ts) — MUST be unique per app so a shared
   * Busabase Folder never mismatches the apps' provisioned field shapes.
   */
  schemaProfile: string;
  /** Default Base slugs, used without a Folder id and overridable per deploy (see above). */
  baseSlugs: CmsIntegrationBaseSlugs;
  cache?: CmsIntegrationCacheConfig;
  /** Passed straight through to `createBusabaseCms`. Leave unset for the SDK default. */
  invalidRecords?: "skip" | "throw";
  onInvalidRecord?: (issue: InvalidCmsRecordIssue) => void;
}

/** The fully-resolved, env-derived CMS target. `null` when the integration is off. */
export interface ResolvedCmsConfig {
  baseUrl: string;
  apiKey: string;
  spaceId: string;
  folderId: string | null;
  baseSlugs: CmsIntegrationBaseSlugs;
}

const trimValue = (value: string | undefined): string | null => value?.trim() || null;

/**
 * Pure `BUSABASE_CMS_*` env-var gate. All three of host/key/space are required: you genuinely
 * cannot talk to a Busabase space without an API key, so a partial configuration is treated as
 * "off" rather than as a guaranteed-failing read on every request.
 *
 * Re-reads the environment on every call — deliberately never memoized, unlike the client.
 */
export const readCmsEnvConfig = (
  defaultBaseSlugs: CmsIntegrationBaseSlugs,
  // Only the `BUSABASE_CMS_*` string values are ever read, so this is deliberately the loose
  // record shape rather than `NodeJS.ProcessEnv` — the latter demands `NODE_ENV`, which would
  // force every caller (and every test) to supply an irrelevant field.
  env: Record<string, string | undefined> = process.env,
): ResolvedCmsConfig | null => {
  const baseUrl = trimValue(env.BUSABASE_CMS_BASE_URL);
  const apiKey = trimValue(env.BUSABASE_CMS_API_KEY);
  const spaceId = trimValue(env.BUSABASE_CMS_SPACE_ID);
  if (!baseUrl || !apiKey || !spaceId) return null;

  return {
    baseUrl,
    apiKey,
    spaceId,
    folderId: trimValue(env.BUSABASE_CMS_FOLDER_ID),
    baseSlugs: {
      posts: trimValue(env.BUSABASE_CMS_POSTS_BASE_SLUG) ?? defaultBaseSlugs.posts,
      pages: trimValue(env.BUSABASE_CMS_PAGES_BASE_SLUG) ?? defaultBaseSlugs.pages,
      categories: trimValue(env.BUSABASE_CMS_CATEGORIES_BASE_SLUG) ?? defaultBaseSlugs.categories,
      tags: trimValue(env.BUSABASE_CMS_TAGS_BASE_SLUG) ?? defaultBaseSlugs.tags,
    },
  };
};
