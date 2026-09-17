import "server-only";

import { type CmsRead, readCmsOrFallback, readCmsStatus } from "../fallback";
import { buildCmsPageJsonLd, type CmsBreadcrumbItem, type CmsJsonLdSite } from "../jsonld";
import type { CmsCanonicalPath, CmsPathHelpers } from "../routing";
import type { PageSummaryVO, PageVO } from "../types";
import type { CmsClientProvider } from "./client";

// ── Page reads ─────────────────────────────────────────────────────────────────

export interface CmsPageReads {
  /** Raw reads — throw when the integration is unconfigured. Prefer the `*OrFallback` variants. */
  listBusabaseLandingPages: () => Promise<PageVO[]>;
  listBusabaseLandingPageSummaries: () => Promise<PageSummaryVO[]>;
  getBusabaseLandingPageByPath: (path: string) => Promise<PageVO | null>;
  listBusabaseLandingPagesOrFallback: () => Promise<PageVO[]>;
  listBusabaseLandingPageSummariesOrFallback: () => Promise<PageSummaryVO[]>;
  getBusabaseLandingPageByPathOrFallback: (path: string) => Promise<PageVO | null>;
  /** Status-aware variant, for callers that turn a missing page into a 404. */
  readBusabaseLandingPageByPath: (path: string) => Promise<CmsRead<PageVO | null>>;
}

export const createCmsPageReads = (
  { getCms, requireCms }: CmsClientProvider,
  appLabel: string,
): CmsPageReads => ({
  listBusabaseLandingPages: async () => requireCms().pages.list(),

  listBusabaseLandingPageSummaries: async () => requireCms().pages.listSummaries(),

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

  listBusabaseLandingPageSummariesOrFallback: async () => {
    const cms = getCms();
    return readCmsOrFallback(
      cms ? () => cms.pages.listSummaries() : null,
      [],
      `list ${appLabel} landing page summaries`,
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

/**
 * The argument object an app's own `generatePageMetadata` helper accepts.
 *
 * Structurally a subset of openlib's `GeneratePageMetadataOptions`, so an app can
 * bind that helper directly. The locale trio and `availableLocales` are what turn a
 * CMS Page's `<head>` from "advertises every locale the app supports" into
 * "advertises the locales this page actually has" — see `getAvailableCmsPageLocales`.
 */
export interface CmsPageMetadataOptions {
  title: string;
  description: string;
  path: string;
  /** The locale the visitor requested. */
  lang: string;
  /** The locale of the page that exists; the canonical points here on a fallback. */
  canonicalLang?: string;
  /** The locale the body really is; drives `og:locale`. */
  contentLang?: string;
  /** Only the locales that really have this page. */
  availableLocales?: readonly string[];
  /** The CMS `canonical-url` field, when an editor set one. */
  canonicalUrl?: string;
  /** Page title, for apps that render a per-page OG image from text. */
  imageText?: string;
  /**
   * A CMS `seo-title` is a COMPLETE title an editor authored, not a fragment for the
   * app's `title.template` to decorate — running it through the template produced the
   * live `Buda AI - GPT-6 Astra for Agent Workflows | Buda`.
   */
  absoluteTitle?: boolean;
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
  /** Carries `options.supportedLocales` — the set `getAvailableCmsPageLocales` filters. */
  cmsPathHelpers: CmsPathHelpers;
}

export interface CmsPageHelpersOptions<TMetadata, TPage extends CmsPageIdentity = PageVO> {
  integration: CmsPageHelpersIntegration<TPage>;
  /**
   * The app's own metadata helper. Injected and typed structurally so the SDK does not depend
   * on any app's site config.
   */
  generatePageMetadata: (options: CmsPageMetadataOptions) => TMetadata;
  /**
   * Site identity for structured data. Supply it and `buildCmsPageJsonLd` produces the
   * page's JSON-LD nodes; omit it and that helper returns `[]`, so an app that has not
   * opted in emits nothing rather than half-formed schema.
   */
  jsonLdSite?: CmsJsonLdSite;
  /** Localized label for the breadcrumb root. Defaults to "Home". */
  homeLabel?: (locale: string) => string;
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
  /**
   * NOT IMPLEMENTED: 301s from a Page's CMS `legacy-paths`.
   *
   * The field is parsed into the VO and still nothing reads it. Honouring it means
   * scanning every Page for a claimed path, and the only available read for that is
   * `pages.list()` — measured at ~2.9MB against the real CMS because every record
   * carries its rendered body, which is over Next's 2MB data-cache ceiling and so is
   * refetched in full on each call. That read would land on the 404 path, i.e. on
   * exactly the requests bots generate most, which is a worse problem than the missing
   * redirect. It needs a CMS-side field projection (paths + legacy-paths, no bodies)
   * or a dedicated index first.
   */

  /**
   * The locales that really have a Page at this path, in the app's own locale order.
   *
   * This is the input hreflang has to be built from. Advertising every supported
   * locale for a Page that exists only in English produces annotations that
   * contradict the canonical (which points at the English original), and Google
   * responds by discarding the entire hreflang cluster — so the untranslated
   * locales gain nothing and the real one loses its annotation too.
   *
   * Backed by a single `list()` read, not one probe per locale.
   */
  getAvailableCmsPageLocales: (path: string | readonly string[]) => Promise<string[]>;
  /**
   * The JSON-LD nodes for a resolved Page: a `WebPage`, a `BreadcrumbList` built from the
   * ancestor Pages that actually exist, and a `FAQPage` when the body really contains a
   * `<details>`-style FAQ. Returns `[]` when the app configured no `jsonLdSite`.
   *
   * Lives here rather than in each route so the five apps rendering CMS Pages share one
   * implementation — and so the breadcrumb trail is derived from real Pages instead of
   * being guessed from URL segments that may not correspond to anything.
   */
  buildCmsPageJsonLd: (page: TPage, lang: string) => Promise<Array<Record<string, unknown>>>;
  /**
   * Async because a correct hreflang set cannot be derived from the Page alone —
   * it needs to know which sibling locales exist. Callers already run inside an
   * async `generateMetadata`, so this costs them nothing but an `await`.
   */
  generateCmsPageMetadata: (
    page: PageVO,
    lang: string,
  ) => Promise<TMetadata | Record<string, never>>;
}

export const createCmsPageHelpers = <TMetadata, TPage extends CmsPageIdentity = PageVO>({
  integration,
  generatePageMetadata,
  jsonLdSite,
  homeLabel = () => "Home",
}: CmsPageHelpersOptions<TMetadata, TPage>): CmsPageHelpers<TMetadata, TPage> => {
  const {
    buildCmsPath,
    cmsPathHelpers,
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

  const getAvailableCmsPageLocales = async (path: string | readonly string[]) => {
    const { supportedLocales } = cmsPathHelpers.options;

    // One strict per-locale probe each, in parallel — NOT a single `pages.list()`.
    //
    // The list looks cheaper (one read instead of N) and that is what this originally
    // did. Measured against the real CMS it is the opposite: the full Page list is
    // ~2.9MB because every record carries its rendered `body`, which is over Next's 2MB
    // data-cache ceiling, so it is refetched in full on EVERY page render:
    //   "Failed to set Next.js data cache for unstable_cache listPages,
    //    items over 2MB can not be cached (2940700 bytes)"
    // The per-path reads are small and individually cacheable, so after the first render
    // these are cache hits. Revisit only if the CMS grows a field projection that can
    // fetch paths and locales without bodies.
    const probes = await Promise.all(
      supportedLocales.map(async (locale) => ((await getForLocale(locale, path)) ? locale : null)),
    );

    return probes.filter((locale): locale is string => locale !== null);
  };

  const generateCmsPageMetadata = async (
    page: PageVO,
    lang: string,
  ): Promise<TMetadata | Record<string, never>> => {
    const parsed = parseCmsPath(page.path);
    if (!parsed) return {};

    // `lang` is what the visitor asked for; `parsed.locale` is the locale the resolved Page
    // actually belongs to. They differ only on a locale fallback (an untranslated Page served
    // in English), and there the canonical URL has to point at the page that really exists
    // rather than at the untranslated request URL.
    const contentLocale = isCmsContentForLocale(page, lang) ? lang : parsed.locale;
    const availableLocales = await resolveAvailableLocales(parsed.pathWithoutLocale, contentLocale);

    return generatePageMetadata({
      title: page.seoTitle ?? page.title,
      description: page.seoDescription ?? "",
      path: parsed.pathWithoutLocale,
      lang,
      canonicalLang: contentLocale,
      contentLang: contentLocale,
      availableLocales,
      // An editor-set canonical wins over the computed one; it also suppresses hreflang,
      // because we cannot know the alternates of a URL we did not compute.
      canonicalUrl: page.canonicalUrl ?? undefined,
      imageText: page.seoTitle ?? page.title,
      // Only when the editor actually authored an SEO title. A page falling back to its
      // plain `title` IS a fragment, and should still get the app's template.
      absoluteTitle: Boolean(page.seoTitle),
      type: "website",
    });
  };

  /**
   * The available-locale set, with the content locale guaranteed present.
   *
   * `listBusabaseLandingPagesOrFallback` returns `[]` when the CMS is unreachable, and an
   * empty hreflang set would silently strip a page's self-reference on every transient CMS
   * outage. The locale that produced the page we are rendering demonstrably has a version
   * of it, so it belongs in the set no matter what the list read returned.
   */
  const resolveAvailableLocales = async (
    pathWithoutLocale: string,
    contentLocale: string,
  ): Promise<string[]> => {
    const locales = await getAvailableCmsPageLocales(pathWithoutLocale);
    if (locales.includes(contentLocale)) return locales;

    const { supportedLocales } = cmsPathHelpers.options;
    return supportedLocales.filter(
      (locale) => locale === contentLocale || locales.includes(locale),
    );
  };

  /** Optional on an app's Page VO for the same reason as `legacyPaths` — read defensively. */
  const stringFieldOf = (page: TPage, key: "body" | "title" | "seoTitle"): string | null => {
    const value = (page as Record<string, unknown>)[key];
    return typeof value === "string" && value ? value : null;
  };

  /**
   * A breadcrumb trail built only from ancestor Pages that actually exist.
   *
   * Deriving it from URL segments alone would invent trail entries for paths that
   * 404 — `/gpt-6-astra/coding` would claim a `/gpt-6-astra` crumb whether or not
   * that Page exists. Every intermediate crumb here is a real, resolvable Page.
   */
  const buildBreadcrumbTrail = async (
    locale: string,
    segments: readonly string[],
    leafTitle: string,
    leafUrl: string,
    baseUrl: string,
  ): Promise<CmsBreadcrumbItem[]> => {
    const rootPath = buildCmsPath(locale, "") ?? "";
    const trail: CmsBreadcrumbItem[] = [
      { name: homeLabel(locale), url: `${baseUrl}${rootPath === "/" ? "" : rootPath}` },
    ];

    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestorSegments = segments.slice(0, depth);
      const ancestor = await getForLocale(locale, ancestorSegments);
      if (!ancestor) continue;
      const ancestorPath = parseCmsPath(ancestor.path)?.canonicalPath;
      if (!ancestorPath) continue;
      trail.push({
        name:
          stringFieldOf(ancestor, "seoTitle") ??
          stringFieldOf(ancestor, "title") ??
          ancestorSegments[depth - 1],
        url: `${baseUrl}${ancestorPath}`,
      });
    }

    trail.push({ name: leafTitle, url: leafUrl });
    return trail;
  };

  const buildCmsPageJsonLdForRequest = async (
    page: TPage,
    lang: string,
  ): Promise<Array<Record<string, unknown>>> => {
    if (!jsonLdSite) return [];

    const parsed = parseCmsPath(page.path);
    if (!parsed) return [];

    const contentLocale = isCmsContentForLocale(page, lang) ? lang : parsed.locale;
    const url = `${jsonLdSite.baseUrl}${parsed.canonicalPath}`;
    const title = stringFieldOf(page, "seoTitle") ?? stringFieldOf(page, "title") ?? "";

    return buildCmsPageJsonLd(jsonLdSite, {
      url,
      title,
      description: (page as { seoDescription?: string | null }).seoDescription ?? null,
      // The language of the BODY, not of the request — on a fallback these differ, and
      // labelling English content as zh-CN is exactly the kind of wrong-but-plausible
      // structured data that is worse than none.
      lang: contentLocale,
      dateModified: (page as { updatedAt?: string }).updatedAt ?? null,
      breadcrumbs: await buildBreadcrumbTrail(
        contentLocale,
        parsed.segments,
        title,
        url,
        jsonLdSite.baseUrl,
      ),
      bodyHtml: stringFieldOf(page, "body") ?? undefined,
    });
  };

  return {
    getCmsPageForLocale: getForLocale,
    getCmsPageForRequest,
    resolveCmsPageForRequest,
    readCmsPageForRequest,
    readResolvedCmsPageForRequest,
    getAvailableCmsPageLocales,
    buildCmsPageJsonLd: buildCmsPageJsonLdForRequest,
    generateCmsPageMetadata,
  };
};
