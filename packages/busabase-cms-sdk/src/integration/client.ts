import "server-only";

import type { BusabaseCms } from "../content";
import { createCachedBusabaseCms } from "../next";
import {
  type CmsIntegrationCacheTags,
  type CmsIntegrationConfig,
  DEFAULT_CMS_REVALIDATE_SECONDS,
  type ResolvedCmsConfig,
  readCmsEnvConfig,
} from "./config";

/**
 * Explicit Next data-cache key prefix. Two reasons it is never left to the SDK's default:
 *
 * 1. App identity — the SDK's own default prefix (see `resolveBusabaseCmsCacheKeyPrefix`) is
 *    derived purely from the CMS target (host / space / folder / profile / Base slugs) and
 *    carries no app identity at all. `cacheNamespace` (unique per app) is the first element
 *    here, so no two apps can ever share an entry even when they read the very same Bases.
 * 2. Re-pointing safety — folder id, schema profile and all four Base slugs are part of the
 *    key, so changing any of them at deploy time starts from a cold cache instead of serving
 *    content read out of a different Base.
 *
 * The API key is deliberately NOT part of the key (it is a secret, and it does not change
 * which records are addressed).
 */
export const buildCmsCacheKeyPrefix = (
  config: Pick<CmsIntegrationConfig, "cacheNamespace" | "schemaProfile">,
  resolved: ResolvedCmsConfig,
): string[] => [
  "busabase-cms-sdk",
  config.cacheNamespace,
  resolved.baseUrl,
  resolved.spaceId,
  resolved.folderId ?? "no-folder",
  config.schemaProfile,
  resolved.baseSlugs.posts,
  resolved.baseSlugs.pages,
  resolved.baseSlugs.categories,
  resolved.baseSlugs.tags,
];

/** `revalidateTag` targets per collection, defaulting to `<cacheNamespace>:cms-<collection>`. */
export const resolveCmsCacheTags = (
  config: Pick<CmsIntegrationConfig, "cacheNamespace" | "cache">,
): Required<CmsIntegrationCacheTags> => ({
  posts: config.cache?.tags?.posts ?? [`${config.cacheNamespace}:cms-posts`],
  pages: config.cache?.tags?.pages ?? [`${config.cacheNamespace}:cms-pages`],
  categories: config.cache?.tags?.categories ?? [`${config.cacheNamespace}:cms-categories`],
  tags: config.cache?.tags?.tags ?? [`${config.cacheNamespace}:cms-tags`],
});

export interface CmsClientProvider {
  /** `null` when the integration is unconfigured — callers degrade to bundled content. */
  getCms: () => BusabaseCms | null;
  /** Throws when the integration is unconfigured. Prefer `getCms` + `readCmsOrFallback`. */
  requireCms: () => BusabaseCms;
  getCmsConfig: () => ResolvedCmsConfig | null;
  isBusabaseCmsEnabled: () => boolean;
}

export const createCmsClientProvider = (config: CmsIntegrationConfig): CmsClientProvider => {
  const getCmsConfig = (): ResolvedCmsConfig | null => readCmsEnvConfig(config.baseSlugs);

  /**
   * When this is false, every `*OrFallback` read skips calling the CMS entirely (see the
   * `readCmsOrFallback(enabled ? op : null, ...)` calls in posts/pages/taxonomy) — zero network
   * attempts, identical to pure-local-MDX behavior.
   */
  const isBusabaseCmsEnabled = (): boolean => getCmsConfig() !== null;

  // Memoized per integration instance: the cached client is built once per server process.
  // `null` (unconfigured) is memoized too.
  let cachedCms: BusabaseCms | null | undefined;

  const getCms = (): BusabaseCms | null => {
    if (cachedCms !== undefined) return cachedCms;

    const resolved = getCmsConfig();
    if (!resolved) {
      cachedCms = null;
      return cachedCms;
    }

    cachedCms = createCachedBusabaseCms(
      {
        config: {
          baseUrl: resolved.baseUrl,
          apiKey: resolved.apiKey,
          spaceId: resolved.spaceId,
        },
        folderId: resolved.folderId ?? undefined,
        lazyCreate: Boolean(resolved.folderId),
        schemaProfile: config.schemaProfile,
        // Only used without a Folder id — Folder mode already gets unique identity from the
        // Folder itself.
        baseSlugs: resolved.folderId ? undefined : resolved.baseSlugs,
        invalidRecords: config.invalidRecords,
        onInvalidRecord: config.onInvalidRecord,
      },
      {
        revalidate: config.cache?.revalidate ?? DEFAULT_CMS_REVALIDATE_SECONDS,
        tags: resolveCmsCacheTags(config),
        keyPrefix: buildCmsCacheKeyPrefix(config, resolved),
      },
    );
    return cachedCms;
  };

  const requireCms = (): BusabaseCms => {
    const cms = getCms();
    if (!cms) {
      throw new Error(
        `[busabase-cms] ${config.appLabel}: BUSABASE_CMS_BASE_URL, BUSABASE_CMS_API_KEY and ` +
          "BUSABASE_CMS_SPACE_ID must all be set before reading CMS content",
      );
    }
    return cms;
  };

  return { getCms, requireCms, getCmsConfig, isBusabaseCmsEnabled };
};
