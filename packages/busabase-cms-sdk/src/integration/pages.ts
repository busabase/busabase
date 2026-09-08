import "server-only";

import { type CmsRead, readCmsOrFallback, readCmsStatus } from "../fallback";
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
  /** Status-aware variant, for callers that turn a missing page into a 404. */
  readBusabaseLandingPageByPath: (path: string) => Promise<CmsRead<PageVO | null>>;
}

export const createCmsPageReads = (
  { getCms, requireCms }: CmsClientProvider,
  appLabel: string,
): CmsPageReads => ({
  listBusabaseLandingPages: async () => requireCms().pages.list(),

  getBusabaseLandingPageByPath: async (path) => requireCms().pages.getByPath(path),

  readBusabaseLandingPageByPath: async (path) => {
    const cms = getCms();
    return readCmsStatus(
      cms ? () => cms.pages.getByPath(path) : null,
      null as PageVO | null,
      `get ${appLabel} page`,
    );
  },

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
  /** Status-aware variant, for callers that turn a missing page into a 404. */
  readBusabaseLandingPageByPath: (path: string) => Promise<CmsRead<PageVO | null>>;
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
  /**
   * Status-aware variant. A CMS Page has no local-MDX equivalent, so a catch-all
   * route cannot otherwise tell "no page at this path" (a correct, cacheable
   * 404) from "the CMS is unreachable" (a 404 that would be cached as though the
   * page had been deleted).
   */
  readCmsPageForRequest: (
    lang: string,
    path: string | readonly string[],
  ) => Promise<CmsRead<PageVO | null>>;
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
    readBusabaseLandingPageByPath,
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

  const readCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<CmsRead<PageVO | null>> => {
    const canonicalPath = buildCmsPath(lang, path);
    // A path this app cannot even form is genuinely "no such page" — no read needed.
    if (!canonicalPath) return { status: "ok", data: null };

    const read = await readBusabaseLandingPageByPath(canonicalPath);
    if (read.status !== "ok") return read;
    const page = read.data;
    return { status: "ok", data: page && isCmsContentForLocale(page, lang) ? page : null };
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

  return { getCmsPageForRequest, readCmsPageForRequest, generateCmsPageMetadata };
};
