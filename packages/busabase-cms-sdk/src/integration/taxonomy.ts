import "server-only";

import { readCmsOrFallback } from "../fallback";
import type { CategoryVO, TagVO } from "../types";
import type { CmsClientProvider } from "./client";

export interface CmsTaxonomyReads {
  /** Raw reads — throw when the integration is unconfigured. Prefer the `*OrFallback` variants. */
  listBusabaseCategories: () => Promise<CategoryVO[]>;
  listBusabaseCategoriesOrFallback: () => Promise<CategoryVO[]>;
  listBusabaseTags: () => Promise<TagVO[]>;
  listBusabaseTagsOrFallback: () => Promise<TagVO[]>;
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

  listBusabaseTagsOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(cms ? () => cms.tags.list() : null, [], `list ${appLabel} tags`);
  },
});
