import "server-only";

import { type CmsRead, readCmsOrFallback, readCmsStatus } from "../fallback";
import type { CategoryVO, TagVO } from "../types";
import type { CmsClientProvider } from "./client";

export interface CmsTaxonomyReads {
  /** Raw reads — throw when the integration is unconfigured. Prefer the `*OrFallback` variants. */
  listBusabaseCategories: () => Promise<CategoryVO[]>;
  listBusabaseCategoriesOrFallback: () => Promise<CategoryVO[]>;
  listBusabaseTags: () => Promise<TagVO[]>;
  listBusabaseTagsOrFallback: () => Promise<TagVO[]>;
  /**
   * Status-aware variants, for callers that turn the result into a 404.
   * A Category or Tag exists only in the CMS — there is no local fallback — so
   * "the CMS is unreachable" and "no such taxonomy" are otherwise identical here.
   */
  readBusabaseCategories: () => Promise<CmsRead<CategoryVO[]>>;
  readBusabaseTags: () => Promise<CmsRead<TagVO[]>>;
}

export const createCmsTaxonomyReads = (
  { getCms, requireCms }: CmsClientProvider,
  appLabel: string,
): CmsTaxonomyReads => ({
  listBusabaseCategories: async () => requireCms().categories.list(),

  listBusabaseCategoriesOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.categories.list() : null,
      [],
      `list ${appLabel} categories`,
    );
  },

  listBusabaseTags: async () => requireCms().tags.list(),

  readBusabaseCategories: async () => {
    const cms = getCms();
    return readCmsStatus(
      cms ? () => cms.categories.list() : null,
      [] as CategoryVO[],
      `list ${appLabel} categories`,
    );
  },

  readBusabaseTags: async () => {
    const cms = getCms();
    return readCmsStatus(
      cms ? () => cms.tags.list() : null,
      [] as TagVO[],
      `list ${appLabel} tags`,
    );
  },

  listBusabaseTagsOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(cms ? () => cms.tags.list() : null, [], `list ${appLabel} tags`);
  },
});
