import "server-only";

import { readCmsOrFallback } from "../fallback";
import type { CmsCanonicalPath } from "../routing";
import type { PageVO } from "../types";
import type { CmsClientProvider } from "./client";

// ── Page reads ─────────────────────────────────────────────────────────────────

export interface CmsPageReads {
  /** Raw reads — throw when the integration is unconfigured. Prefer the `*OrFallback` variants. */
  listBusabaseLandingPages: () => Promise<PageVO[]>;
  getBusabaseLandingPageByPath: (path: string) => Promise<PageVO | null>;
  listBusabaseLandingPagesOrFallback: () => Promise<PageVO[]>;
  getBusabaseLandingPageByPathOrFallback: (path: string) => Promise<PageVO | null>;
}

export const createCmsPageReads = (
  { getCms, requireCms }: CmsClientProvider,
  appLabel: string,
): CmsPageReads => ({
  listBusabaseLandingPages: async () => requireCms().pages.list(),

  getBusabaseLandingPageByPath: async (path) => requireCms().pages.getByPath(path),

  listBusabaseLandingPagesOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.pages.list() : null,
      [],
      `list ${appLabel} landing pages`,
    );
  },

  getBusabaseLandingPageByPathOrFallback: async (path) => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.pages.getByPath(path) : null,
      null,
      `get ${appLabel} landing page ${path}`,
    );
  },
});

// ── Page detail resolution + metadata ──────────────────────────────────────────

/** The argument object an app's own `generatePageMetadata` helper accepts. */
export interface CmsPageMetadataOptions {
  title: string;
  description: string;
  path: string;
  lang: string;
  type: "website" | "article";
}

/** The slice of a `CmsIntegration` the Page helpers depend on. */
export interface CmsPageHelpersIntegration {
  buildCmsPath: (locale: string, path: string | readonly string[]) => string | null;
  parseCmsPath: (path: string) => CmsCanonicalPath | null;
  isCmsContentForLocale: (item: { locale: string; path: string }, locale: string) => boolean;
  getBusabaseLandingPageByPathOrFallback: (path: string) => Promise<PageVO | null>;
}

export interface CmsPageHelpersOptions<TMetadata> {
  integration: CmsPageHelpersIntegration;
  /**
   * The app's own metadata helper. Injected and typed structurally so the SDK does not depend
   * on any app's site config.
   */
  generatePageMetadata: (options: CmsPageMetadataOptions) => TMetadata;
}

export interface CmsPageHelpers<TMetadata> {
  getCmsPageForRequest: (lang: string, path: string | readonly string[]) => Promise<PageVO | null>;
  generateCmsPageMetadata: (page: PageVO, lang: string) => TMetadata | Record<string, never>;
}

export const createCmsPageHelpers = <TMetadata>({
  integration,
  generatePageMetadata,
}: CmsPageHelpersOptions<TMetadata>): CmsPageHelpers<TMetadata> => {
  const {
    buildCmsPath,
    getBusabaseLandingPageByPathOrFallback,
    isCmsContentForLocale,
    parseCmsPath,
  } = integration;

  const getCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<PageVO | null> => {
    const canonicalPath = buildCmsPath(lang, path);
    if (!canonicalPath) return null;

    const page = await getBusabaseLandingPageByPathOrFallback(canonicalPath);
    return page && isCmsContentForLocale(page, lang) ? page : null;
  };

  const generateCmsPageMetadata = (
    page: PageVO,
    lang: string,
  ): TMetadata | Record<string, never> => {
    const parsed = parseCmsPath(page.path);
    if (!parsed || parsed.locale !== lang) return {};

    return generatePageMetadata({
      title: page.seoTitle ?? page.title,
      description: page.seoDescription ?? "",
      path: parsed.pathWithoutLocale,
      lang,
      type: "website",
    });
  };

  return { getCmsPageForRequest, generateCmsPageMetadata };
};
