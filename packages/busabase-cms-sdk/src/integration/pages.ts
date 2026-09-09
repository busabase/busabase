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

/**
 * The locale every other locale falls back to when it has no translation of a Page.
 * Mirrors the Post resolver in ./posts.ts — see `resolvePostPageWithDependencies`.
 */
const FALLBACK_LOCALE = "en";

/** The argument object an app's own `generatePageMetadata` helper accepts. */
export interface CmsPageMetadataOptions {
  title: string;
  description: string;
  path: string;
  lang: string;
  type: "website" | "article";
}

/**
 * All the locale resolver actually reads off a Page: its canonical path and its locale. Kept
 * deliberately narrower than `PageVO` so an app whose own Page VO omits SDK fields it does not
 * store (Buda drops `hero`/`features`/`faqs`) still flows through these helpers with its own
 * type intact, instead of being silently widened back to `PageVO`.
 */
export type CmsPageIdentity = Pick<PageVO, "path" | "locale">;

/**
 * A Page resolved for one request, carrying the locale that actually supplied the content.
 * `isLocaleFallback` is what a route reads to decide whether to render a "not translated yet,
 * showing English" notice. Structurally mirrors `ResolvedCmsPostPage` on the Post side.
 */
export interface ResolvedCmsPage<TPage extends CmsPageIdentity = PageVO> {
  page: TPage;
  requestedLocale: string;
  contentLocale: string;
  isLocaleFallback: boolean;
}

/** The slice of a `CmsIntegration` the Page helpers depend on. */
export interface CmsPageHelpersIntegration<TPage extends CmsPageIdentity = PageVO> {
  buildCmsPath: (locale: string, path: string | readonly string[]) => string | null;
  parseCmsPath: (path: string) => CmsCanonicalPath | null;
  isCmsContentForLocale: (item: { locale: string; path: string }, locale: string) => boolean;
  getBusabaseLandingPageByPathOrFallback: (path: string) => Promise<TPage | null>;
  /** Status-aware variant, for callers that turn a missing page into a 404. */
  readBusabaseLandingPageByPath: (path: string) => Promise<CmsRead<TPage | null>>;
}

export interface CmsPageHelpersOptions<TMetadata, TPage extends CmsPageIdentity = PageVO> {
  integration: CmsPageHelpersIntegration<TPage>;
  /**
   * The app's own metadata helper. Injected and typed structurally so the SDK does not depend
   * on any app's site config.
   */
  generatePageMetadata: (options: CmsPageMetadataOptions) => TMetadata;
}

export interface CmsPageHelpers<TMetadata, TPage extends CmsPageIdentity = PageVO> {
  /**
   * STRICT per-locale lookup: no English fallback, `null` when this exact locale has no Page.
   * Callers that run their own cross-locale cascade (Buda's use-case resolver cascades CMS →
   * bundled ICP → editorial before falling back) must use this — handing them the fallback
   * variant makes every locale look translated, which silently suppresses the "showing English"
   * notice and mislabels the content locale.
   */
  getCmsPageForLocale: (locale: string, path: string | readonly string[]) => Promise<TPage | null>;
  /**
   * The resolved Page only. Falls back to English when the requested locale has no translation,
   * so an untranslated Page renders in English instead of 404ing — the same rule the Post
   * resolver applies. Use `resolveCmsPageForRequest` when the route needs to know it fell back.
   */
  getCmsPageForRequest: (lang: string, path: string | readonly string[]) => Promise<TPage | null>;
  /** Same resolution as `getCmsPageForRequest`, plus which locale supplied the content. */
  resolveCmsPageForRequest: (
    lang: string,
    path: string | readonly string[],
  ) => Promise<ResolvedCmsPage<TPage> | null>;
  /**
   * Status-aware variant. A CMS Page has no local-MDX equivalent, so a catch-all
   * route cannot otherwise tell "no page at this path" (a correct, cacheable
   * 404) from "the CMS is unreachable" (a 404 that would be cached as though the
   * page had been deleted).
   */
  readCmsPageForRequest: (
    lang: string,
    path: string | readonly string[],
  ) => Promise<CmsRead<TPage | null>>;
  /** Status-aware variant of `resolveCmsPageForRequest`. */
  readResolvedCmsPageForRequest: (
    lang: string,
    path: string | readonly string[],
  ) => Promise<CmsRead<ResolvedCmsPage<TPage> | null>>;
  generateCmsPageMetadata: (page: PageVO, lang: string) => TMetadata | Record<string, never>;
}

export const createCmsPageHelpers = <TMetadata, TPage extends CmsPageIdentity = PageVO>({
  integration,
  generatePageMetadata,
}: CmsPageHelpersOptions<TMetadata, TPage>): CmsPageHelpers<TMetadata, TPage> => {
  const {
    buildCmsPath,
    getBusabaseLandingPageByPathOrFallback,
    isCmsContentForLocale,
    parseCmsPath,
    readBusabaseLandingPageByPath,
  } = integration;

  const getForLocale = async (
    locale: string,
    path: string | readonly string[],
  ): Promise<TPage | null> => {
    const canonicalPath = buildCmsPath(locale, path);
    if (!canonicalPath) return null;

    const page = await getBusabaseLandingPageByPathOrFallback(canonicalPath);
    return page && isCmsContentForLocale(page, locale) ? page : null;
  };

  const readForLocale = async (
    locale: string,
    path: string | readonly string[],
  ): Promise<CmsRead<TPage | null>> => {
    const canonicalPath = buildCmsPath(locale, path);
    // A path this app cannot even form is genuinely "no such page" — no read needed.
    if (!canonicalPath) return { status: "ok", data: null };

    const read = await readBusabaseLandingPageByPath(canonicalPath);
    if (read.status !== "ok") return read;
    const page = read.data;
    return { status: "ok", data: page && isCmsContentForLocale(page, locale) ? page : null };
  };

  const resolved = (page: TPage, requestedLocale: string, contentLocale: string) => ({
    page,
    requestedLocale,
    contentLocale,
    isLocaleFallback: contentLocale !== requestedLocale,
  });

  const resolveCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<ResolvedCmsPage<TPage> | null> => {
    // A locale this app cannot even form a path for is not a translation gap — falling back
    // there would turn every unknown first path segment into an English duplicate of the page.
    if (!buildCmsPath(lang, path)) return null;

    const requested = await getForLocale(lang, path);
    if (requested) return resolved(requested, lang, lang);
    if (lang === FALLBACK_LOCALE) return null;

    const fallback = await getForLocale(FALLBACK_LOCALE, path);
    return fallback ? resolved(fallback, lang, FALLBACK_LOCALE) : null;
  };

  const getCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<TPage | null> => (await resolveCmsPageForRequest(lang, path))?.page ?? null;

  const readResolvedCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<CmsRead<ResolvedCmsPage<TPage> | null>> => {
    // Same guard as resolveCmsPageForRequest — an unsupported locale is a real 404, never a
    // fallback, and it needs no read at all to decide that.
    if (!buildCmsPath(lang, path)) return { status: "ok", data: null };

    const requested = await readForLocale(lang, path);
    // An unreachable CMS must stay "unavailable" rather than silently becoming an English
    // fallback — the caller turns "ok + null" into a cacheable 404, and we do not know yet
    // whether this path is genuinely missing.
    if (requested.status !== "ok") return requested;
    if (requested.data) return { status: "ok", data: resolved(requested.data, lang, lang) };
    if (lang === FALLBACK_LOCALE) return { status: "ok", data: null };

    const fallback = await readForLocale(FALLBACK_LOCALE, path);
    if (fallback.status !== "ok") return fallback;
    return {
      status: "ok",
      data: fallback.data ? resolved(fallback.data, lang, FALLBACK_LOCALE) : null,
    };
  };

  const readCmsPageForRequest = async (
    lang: string,
    path: string | readonly string[],
  ): Promise<CmsRead<TPage | null>> => {
    const read = await readResolvedCmsPageForRequest(lang, path);
    return read.status === "ok" ? { status: "ok", data: read.data?.page ?? null } : read;
  };

  const generateCmsPageMetadata = (
    page: PageVO,
    lang: string,
  ): TMetadata | Record<string, never> => {
    const parsed = parseCmsPath(page.path);
    if (!parsed) return {};

    // `lang` is what the visitor asked for; `parsed.locale` is the locale the resolved Page
    // actually belongs to. They differ only on a locale fallback (an untranslated Page served
    // in English), and there the canonical URL has to point at the page that really exists
    // rather than at the untranslated request URL.
    const contentLocale = isCmsContentForLocale(page, lang) ? lang : parsed.locale;

    return generatePageMetadata({
      title: page.seoTitle ?? page.title,
      description: page.seoDescription ?? "",
      path: parsed.pathWithoutLocale,
      lang: contentLocale,
      type: "website",
    });
  };

  return {
    getCmsPageForLocale: getForLocale,
    getCmsPageForRequest,
    resolveCmsPageForRequest,
    readCmsPageForRequest,
    readResolvedCmsPageForRequest,
    generateCmsPageMetadata,
  };
};
