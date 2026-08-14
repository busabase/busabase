import "server-only";

import type { CmsCanonicalPath } from "../routing";
import { type CmsPathHelpers, type CmsTaxonomyKind, createCmsPathHelpers } from "../routing";
import { createCmsClientProvider } from "./client";
import type { CmsIntegrationConfig, ResolvedCmsConfig } from "./config";
import { type CmsPageReads, createCmsPageReads } from "./pages";
import { type CmsPostReads, createCmsPostReads } from "./posts";
import { type CmsTaxonomyReads, createCmsTaxonomyReads } from "./taxonomy";

export {
  buildCmsCacheKeyPrefix,
  type CmsClientProvider,
  createCmsClientProvider,
  resolveCmsCacheTags,
} from "./client";
export {
  type CmsIntegrationBaseSlugs,
  type CmsIntegrationCacheConfig,
  type CmsIntegrationCacheTags,
  type CmsIntegrationConfig,
  DEFAULT_CMS_REVALIDATE_SECONDS,
  type ResolvedCmsConfig,
  readCmsEnvConfig,
} from "./config";
export {
  type CmsPageHelpers,
  type CmsPageHelpersIntegration,
  type CmsPageHelpersOptions,
  type CmsPageMetadataOptions,
  type CmsPageReads,
  createCmsPageHelpers,
  createCmsPageReads,
} from "./pages";
export {
  type BlogCardContent,
  type CmsPostReads,
  type CmsPostResolver,
  type CmsPostResolverDependencies,
  type CmsPostResolverIntegration,
  type CmsPostResolverOptions,
  createCmsPostReads,
  createCmsPostResolver,
  type LocalPostSourceLike,
  mergeBlogCardsByPath,
  type ResolvedCmsPostPage,
} from "./posts";
export { type CmsTaxonomyReads, createCmsTaxonomyReads } from "./taxonomy";

/**
 * The whole per-app Busabase CMS surface, bound once to one app's locale / schema / Base
 * config: canonical-path helpers, the env gate, and the Post / Page / taxonomy reads.
 */
export interface CmsIntegration extends CmsPostReads, CmsPageReads, CmsTaxonomyReads {
  cmsPathHelpers: CmsPathHelpers;
  buildCmsPath: (locale: string, path: string | readonly string[]) => string | null;
  parseCmsPath: (path: string) => CmsCanonicalPath | null;
  isCmsContentForLocale: (item: { locale: string; path: string }, locale: string) => boolean;
  buildCmsTaxonomyArchivePath: (
    kind: CmsTaxonomyKind,
    taxonomy: { locale: string; slug: string },
  ) => string | null;

  isBusabaseCmsEnabled: () => boolean;
  /** Re-reads the environment on every call — never memoized, unlike the client itself. */
  getCmsConfig: () => ResolvedCmsConfig | null;
}

export const createCmsIntegration = (config: CmsIntegrationConfig): CmsIntegration => {
  // Bound once with the caller app's own locale config.
  const cmsPathHelpers = createCmsPathHelpers({
    supportedLocales: config.supportedLocales,
    defaultLocale: config.defaultLocale,
  });

  const provider = createCmsClientProvider(config);

  return {
    cmsPathHelpers,
    buildCmsPath: cmsPathHelpers.buildPath,
    parseCmsPath: cmsPathHelpers.parsePath,
    isCmsContentForLocale: cmsPathHelpers.isForLocale,
    buildCmsTaxonomyArchivePath: cmsPathHelpers.buildTaxonomyArchivePath,
    isBusabaseCmsEnabled: provider.isBusabaseCmsEnabled,
    getCmsConfig: provider.getCmsConfig,
    ...createCmsPostReads(provider, config.appLabel),
    ...createCmsPageReads(provider, config.appLabel),
    ...createCmsTaxonomyReads(provider, config.appLabel),
  };
};
