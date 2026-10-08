/**
 * Page-level metadata helpers: canonical URL + hreflang alternates for a single
 * locale+path, and a `generatePageMetadata` convenience factory built on top of
 * it.
 *
 * Next.js's `generateMetadata` merges results across nested layouts/pages by
 * REPLACING each top-level key wholesale, not deep-merging. In practice this
 * causes three distinct bugs that this module fixes at the source:
 *
 *   1. A page that returns Metadata with no `alternates` key at all still
 *      INHERITS the parent layout's `alternates.canonical` verbatim — typically
 *      the site root — so every child page (docs article, blog post, ...)
 *      would otherwise claim the homepage as its own canonical URL.
 *   2. A page that returns `alternates: { canonical }` without `languages`
 *      silently WIPES OUT the hreflang tags the parent layout set up (Next
 *      does not merge `languages` in from the parent).
 *   3. The same replace-don't-merge rule applies to `openGraph` and `twitter`:
 *      a page returning its own `openGraph` object DROPS the `siteName` (and
 *      `twitter.creator`, `twitter.site`, ...) the root layout established. The
 *      original version of this module guarded only against (1) and (2), so
 *      every page built through it shipped without an `og:site_name` — confirmed
 *      live on buda.im before this was fixed.
 *
 * `getPageAlternates` always returns a complete `{ canonical, languages }`
 * pair (every *available* locale + x-default) so pages can't fall into (1) or
 * (2). `generatePageMetadata` wraps it for the common case and re-asserts the
 * site-level OpenGraph/Twitter identity so pages can't fall into (3).
 *
 * ## hreflang must describe reality, not the app's locale list — two entry points
 *
 * Which locales a page exists in is a FACT about the page, and who owns that
 * fact decides which function a route calls:
 *
 *   - STATIC routes (home, pricing, legal, listing pages): the route itself is
 *     translated into every supported locale, so the app's locale list IS the
 *     fact. `generatePageMetadata` / `getPageAlternates` advertise all of them
 *     and refuse an `availableLocales` argument — passing one is a type error,
 *     which is the signal that the route is content and belongs below.
 *   - CONTENT routes (CMS Posts/Pages, tag/category archives, MDX posts): only
 *     the content source knows which locales exist. `generateContentPageMetadata`
 *     / `getContentPageAlternates` REQUIRE `availableLocales`, so forgetting it
 *     is a compile error instead of a silently wrong `<head>`.
 *
 * The split exists because the old single function DEFAULTED `availableLocales`
 * to every supported locale. Content routes forgot to pass it (every app, until
 * PR #7652) and nothing failed: a post that exists only in English advertised
 * `hreflang="ja"` for a URL whose canonical points back at the English original,
 * which makes Google discard the whole hreflang cluster (no matching return tag)
 * and wastes crawl budget on duplicates. Compute the set with busabase-cms-sdk
 * (`resolvePostMetadataInput`, `getAvailableCmsPageLocales`,
 * `getCmsTaxonomyLocales`) or, for MDX-only apps, `getLocalPostLocales`.
 *
 * ## canonicalLang vs contentLang vs lang
 *
 * They coincide on an ordinary page and diverge only on a locale fallback (a
 * request for an untranslated locale that is served the English original):
 *   - `lang`          — what the visitor asked for; picks the request URL.
 *   - `canonicalLang` — the locale of the page that actually exists; the
 *                       canonical URL must point there, not at the request URL.
 *   - `contentLang`   — the locale the rendered body really is; drives
 *                       `og:locale` so a share card is not mislabelled.
 *
 * Reuses `createCanonicalUrlHelpers` (./canonical-url.ts) rather than
 * recomputing locale-prefix logic. See that file for the layout-level
 * counterpart, and `./middleware.ts` for the i18n proxy/redirect helpers.
 */

import { createCanonicalUrlHelpers } from "./canonical-url";

/**
 * Minimal shape of the subset of Next.js's `Metadata` type this module
 * returns. Deliberately not `import type { Metadata } from "next"` — that
 * would be a static type import of Next's ambient global declarations into
 * this package's single `tsc` compilation unit, which (confirmed) makes
 * `process.env.NODE_ENV` read-only project-wide and breaks unrelated test
 * files that reassign it (e.g. `storage/factory.test.ts`). See the `any`
 * convention already used for NextRequest/NextResponse in `./middleware.ts`
 * for the same reason (openlib is consumed by non-Next.js-typed contexts).
 */
export interface PageMetadata {
  /**
   * A bare string flows through the root layout's `title.template`; `{ absolute }`
   * bypasses it. See `absoluteTitle` on the options for when each is right.
   */
  title: string | { absolute: string };
  description: string;
  keywords?: string[];
  alternates: PageAlternates;
  openGraph: {
    title: string;
    description: string;
    type: "website" | "article";
    url: string;
    /** Present so a page-level `openGraph` cannot wipe the root layout's site name. */
    siteName?: string;
    locale?: string;
    alternateLocale?: string[];
    modifiedTime?: string;
    images: Array<{ url: string; width?: number; height?: number; alt: string }>;
  };
  twitter: {
    card: "summary_large_image";
    title: string;
    description: string;
    /** Present for the same replace-don't-merge reason as `openGraph.siteName`. */
    site?: string;
    creator?: string;
    images: string[];
  };
}

export interface PageAlternatesConfig<T extends string> {
  /** App's absolute base URL, e.g. "https://example.com" (no trailing slash) */
  baseUrl: string;
  /** Default locale whose URL prefix is hidden (e.g. 'en') */
  defaultLocale: T;
  /** Supported locales for this app */
  supportedLocales: readonly T[];
}

export interface PageAlternates {
  canonical: string;
  languages: Record<string, string>;
}

export interface PageUrlAndAlternates {
  /** Canonical URL for this locale+path (default locale prefix hidden) */
  url: string;
  /** Complete `alternates`: canonical + hreflang for every available locale + x-default */
  alternates: PageAlternates;
}

export interface PageAlternatesHelpers {
  /**
   * STATIC route: canonical URL + `alternates` advertising EVERY supported locale.
   * Use this directly when a statically-translated page assembles its own Metadata
   * shape (custom openGraph/twitter fields, extra keys like `keywords`/`authors`, a
   * page-specific OG image, etc.) instead of the full `generatePageMetadata`.
   *
   * Takes no `availableLocales` on purpose — for content whose locales vary per
   * item, use `getContentPageAlternates`. See the module doc.
   */
  getPageAlternates(locale: string, path?: string): PageUrlAndAlternates;
  /**
   * CONTENT route: same as `getPageAlternates`, but the hreflang set is exactly
   * `availableLocales` — the locales that really have this item. Required, so a
   * content route cannot fall back to "every locale" by forgetting it.
   */
  getContentPageAlternates(
    locale: string,
    path: string,
    availableLocales: readonly string[],
  ): PageUrlAndAlternates;
}

/**
 * Strip a trailing slash so `/docs/` and `/docs` cannot produce two different
 * canonical URLs for one page. The root path stays `/`.
 *
 * This is not cosmetic: before it existed, the apps' docs catch-all route built
 * its path by interpolating the slug and emitted `…/docs/` for the index while
 * the page is actually served at `…/docs` — a self-inflicted duplicate, recorded
 * as a known issue when page-level canonicals first landed (PR #5234), fixed here.
 */
function normalizeMetadataPath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

/**
 * Do two URLs address the same page? Compares pathname only, so an editor-supplied
 * production canonical still matches the same page rendered on a preview or local
 * host. Trailing slashes are ignored for the same reason `normalizeMetadataPath` exists.
 */
function isSamePath(a: string, b: string): boolean {
  const pathOf = (value: string) => {
    try {
      return normalizeMetadataPath(new URL(value).pathname);
    } catch {
      // Not absolute — treat it as a bare path.
      return normalizeMetadataPath(value);
    }
  };
  return pathOf(a) === pathOf(b);
}

/**
 * OpenGraph wants an `en_US`-style locale; our locale codes are BCP-47
 * (`en`, `zh-CN`). A region can't be derived from a bare language code, so an
 * app that cares (buda maps `ja` → `ja_JP`) passes `openGraphLocales`. Without
 * a mapping we only do the part that is unambiguous: `zh-CN` → `zh_CN`.
 */
function toOpenGraphLocale(
  locale: string,
  openGraphLocales?: Readonly<Record<string, string>>,
): string {
  return openGraphLocales?.[locale] ?? locale.replace(/-/g, "_");
}

/**
 * Create locale-aware canonical URL helpers bound to an app's base URL and locale config.
 */
export function createPageAlternatesHelpers<T extends string>(
  config: PageAlternatesConfig<T>,
): PageAlternatesHelpers {
  const { baseUrl, defaultLocale, supportedLocales } = config;
  const { getLocalizedUrl } = createCanonicalUrlHelpers({ defaultLocale, supportedLocales });

  function getContentPageAlternates(
    locale: string,
    path: string,
    availableLocales: readonly string[],
  ): PageUrlAndAlternates {
    const normalizedPath = normalizeMetadataPath(path);
    const url = getLocalizedUrl(baseUrl, locale, normalizedPath);
    const languages: Record<string, string> = {};
    for (const availableLocale of availableLocales) {
      languages[availableLocale] = getLocalizedUrl(baseUrl, availableLocale, normalizedPath);
    }
    // x-default names the fallback for unmatched languages, so it only makes sense
    // when the default locale is one of the versions that actually exists.
    if (availableLocales.includes(defaultLocale)) {
      languages["x-default"] = getLocalizedUrl(baseUrl, defaultLocale, normalizedPath);
    }

    return { url, alternates: { canonical: url, languages } };
  }

  // A static route exists in every supported locale — that list IS its available set.
  const getPageAlternates = (locale: string, path = ""): PageUrlAndAlternates =>
    getContentPageAlternates(locale, path, supportedLocales);

  return { getPageAlternates, getContentPageAlternates };
}

export interface PageMetadataConfig<T extends string> extends PageAlternatesConfig<T> {
  /** Default OG/Twitter image URL used when a page doesn't pass its own `imageUrl` */
  defaultImageUrl: string;
  /**
   * Site name for `og:site_name`. Set it — without it every page built here
   * silently drops the root layout's `og:site_name` (see bug 3 in the module doc).
   */
  siteName?: string;
  /** `twitter:site` handle, e.g. "@buda_agent". Same replace-don't-merge reason. */
  twitterSite?: string;
  /** `twitter:creator` handle. Same replace-don't-merge reason. */
  twitterCreator?: string;
  /** Locale → OpenGraph locale, e.g. `{ en: "en_US", ja: "ja_JP" }`. */
  openGraphLocales?: Readonly<Record<string, string>>;
  /**
   * Build a page-specific OG image URL from `imageText` (typically an `/og?text=`
   * route). Without it, `imageText` is ignored and `defaultImageUrl` is used.
   */
  buildImageTextUrl?: (text: string) => string;
}

export interface GeneratePageMetadataOptions {
  title: string;
  description: string;
  path: string;
  /** The locale the visitor requested — picks the request URL. */
  lang: string;
  /**
   * The locale of the page that actually exists; the canonical URL points here.
   * Defaults to `lang`, and differs only on a locale fallback.
   */
  canonicalLang?: string;
  /**
   * The locale the rendered body really is; drives `og:locale`. Defaults to
   * `lang`, and differs only on a locale fallback.
   */
  contentLang?: string;
  /**
   * Not accepted here: `generatePageMetadata` is the STATIC-route entry point and
   * always advertises every supported locale. A route that knows its item exists
   * in only some locales is a content route — call `generateContentPageMetadata`,
   * where this field is required. (Typed `never` so passing it is a compile error
   * pointing at this comment, rather than being silently accepted.)
   */
  availableLocales?: never;
  /**
   * An explicit canonical URL that overrides the computed one — a CMS
   * `canonical-url` field, or a page deliberately consolidated onto another URL.
   *
   * hreflang is suppressed ONLY when this points at a different PATH than the
   * computed self-canonical, i.e. a genuine consolidation onto another page. An
   * hreflang cluster is valid only when each member's canonical points back at
   * itself, and we cannot know the alternates of a page we did not compute — a
   * guessed set is what makes Google discard the annotations outright.
   *
   * The path comparison deliberately ignores host and scheme. Editors fill this
   * field with the PRODUCTION URL, so a preview, staging, or local render would
   * otherwise see `https://buda.im/x` against `http://localhost:3040/x`, read a
   * self-canonical as a consolidation, and silently drop hreflang everywhere.
   * Caught exactly that way on a real page.
   */
  canonicalUrl?: string;
  type?: "website" | "article";
  imageUrl?: string;
  /** Page-specific OG image text, rendered through `buildImageTextUrl`. */
  imageText?: string;
  /**
   * Treat `title` as the COMPLETE document title and bypass the root layout's
   * `title.template`.
   *
   * A template like `Buda AI - %s` exists for pages that supply a fragment
   * ("Pricing" -> "Buda AI - Pricing"). A CMS `seo-title` is not a fragment: an
   * editor authored the whole title, brand included. Running it through the
   * template anyway is what produced the live
   * `Buda AI - GPT-6 Astra for Agent Workflows | Buda` — the brand twice, and a
   * `<title>` that no longer matched its own `og:title` (OpenGraph does not apply
   * the template). Stripping the duplicate with a regex would be guessing at the
   * editor's intent; honouring it verbatim is not.
   */
  absoluteTitle?: boolean;
  /** Page-specific keywords. Omit rather than inheriting an unrelated site-wide list. */
  keywords?: readonly string[];
  /**
   * ISO 8601 last-modified timestamp. Emitted only for `type: "article"` —
   * `og:modified_time` belongs to OpenGraph's article variant, and Next's own
   * `Metadata` type rejects it on a `website`. Landing pages express the same
   * fact through JSON-LD `dateModified` instead.
   */
  modifiedTime?: string;
}

/**
 * Options for a CONTENT route: the static options plus a REQUIRED `availableLocales`.
 * Structurally what busabase-cms-sdk's `resolvePostMetadataInput` returns (plus `type`),
 * so a CMS post route is `generateContentPageMetadata({ ...input, type: "article" })`.
 */
export interface GenerateContentPageMetadataOptions
  extends Omit<GeneratePageMetadataOptions, "availableLocales"> {
  /**
   * The locales that really have THIS item (its own CMS record or its own MDX
   * file — never a fumadocs fallback), in any order. Drives hreflang and
   * `og:locale:alternate`; `x-default` is added only when the default locale is
   * among them.
   */
  availableLocales: readonly string[];
  /**
   * The item's own cover image (a CMS `cover-image`, a local post's `image`). Used as
   * the OG/Twitter image when no explicit `imageUrl` is passed, so a route that spreads
   * busabase-cms-sdk's metadata input gets its post's cover on share cards without
   * having to remember to wire it up — which is how every app except one shipped
   * posts with covers that never reached a share card.
   */
  coverImageUrl?: string;
}

export interface PageMetadataHelpers extends PageAlternatesHelpers {
  /**
   * STATIC route: OpenGraph/Twitter/alternates metadata for a page translated into
   * every supported locale. Apps instantiate this once with their own config and
   * re-export it from `lib/metadata-helper.ts`.
   *
   * For CMS/MDX content use `generateContentPageMetadata` — see the module doc.
   */
  generatePageMetadata(options: GeneratePageMetadataOptions): PageMetadata;
  /**
   * CONTENT route: identical output shape, but `availableLocales` is required so
   * the hreflang set can only come from the content source, never from a default.
   */
  generateContentPageMetadata(options: GenerateContentPageMetadataOptions): PageMetadata;
  /**
   * Locale → OpenGraph locale (`zh-CN` → `zh_CN`), for pages that assemble their
   * own `openGraph` block instead of calling `generatePageMetadata`.
   */
  getOpenGraphLocale(locale: string): string;
  /**
   * Every OpenGraph locale except the page's own. Pass `availableLocales` for CMS
   * content, for the same reason hreflang needs it.
   */
  getOpenGraphAlternateLocales(locale: string, availableLocales?: readonly string[]): string[];
}

/**
 * Create a page-level `generatePageMetadata` (+ the lower-level
 * `getPageAlternates`) bound to an app's base URL, locale config, and default
 * OG image.
 */
export function createPageMetadataHelpers<T extends string>(
  config: PageMetadataConfig<T>,
): PageMetadataHelpers {
  const {
    defaultImageUrl,
    siteName,
    twitterSite,
    twitterCreator,
    openGraphLocales,
    buildImageTextUrl,
    ...alternatesConfig
  } = config;
  const { getPageAlternates, getContentPageAlternates } =
    createPageAlternatesHelpers(alternatesConfig);

  const getOpenGraphLocale = (locale: string) => toOpenGraphLocale(locale, openGraphLocales);

  const getOpenGraphAlternateLocales = (
    locale: string,
    availableLocales: readonly string[] = alternatesConfig.supportedLocales,
  ) =>
    availableLocales
      .filter((candidate) => candidate !== locale)
      .map((candidate) => toOpenGraphLocale(candidate, openGraphLocales));

  function generateContentPageMetadata({
    title,
    description,
    path,
    lang,
    canonicalLang = lang,
    contentLang = lang,
    availableLocales,
    canonicalUrl,
    type = "website",
    imageUrl,
    coverImageUrl,
    imageText,
    absoluteTitle = false,
    keywords,
    modifiedTime,
  }: GenerateContentPageMetadataOptions): PageMetadata {
    // The canonical URL follows the page that exists, not the URL that was requested;
    // the hreflang set stays keyed on the same path so every alternate agrees.
    const computed = getContentPageAlternates(canonicalLang, path, availableLocales);
    const url = canonicalUrl ?? computed.url;
    const consolidatedElsewhere = Boolean(canonicalUrl) && !isSamePath(url, computed.url);
    const alternates: PageAlternates = consolidatedElsewhere
      ? { canonical: url, languages: {} }
      : { canonical: url, languages: computed.alternates.languages };
    const ownImage = imageUrl ?? coverImageUrl;
    const image =
      ownImage ?? (imageText && buildImageTextUrl ? buildImageTextUrl(imageText) : defaultImageUrl);
    const alternateLocale = getOpenGraphAlternateLocales(contentLang, availableLocales);

    return {
      // og:title / twitter:title always stay the bare string — the template is a
      // document-title concern and must not leak into share cards.
      title: absoluteTitle ? { absolute: title } : title,
      description,
      ...(keywords?.length ? { keywords: [...keywords] } : {}),
      alternates,
      openGraph: {
        title,
        description,
        type,
        url,
        ...(siteName ? { siteName } : {}),
        locale: toOpenGraphLocale(contentLang, openGraphLocales),
        ...(alternateLocale.length ? { alternateLocale } : {}),
        ...(modifiedTime && type === "article" ? { modifiedTime } : {}),
        // 1200x630 is true only of the images generated here (the site default and
        // `imageText` cards); an uploaded cover can be any size, and wrong declared
        // dimensions make some scrapers crop or reject it — so omit them there.
        images: [
          ownImage
            ? { url: image, alt: title }
            : { url: image, width: 1200, height: 630, alt: title },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        ...(twitterSite ? { site: twitterSite } : {}),
        ...(twitterCreator ? { creator: twitterCreator } : {}),
        images: [image],
      },
    };
  }

  // A static route exists in every supported locale — that list IS its available set.
  const generatePageMetadata = (options: GeneratePageMetadataOptions): PageMetadata =>
    generateContentPageMetadata({
      ...options,
      availableLocales: alternatesConfig.supportedLocales,
    });

  return {
    getPageAlternates,
    getContentPageAlternates,
    generatePageMetadata,
    generateContentPageMetadata,
    getOpenGraphLocale,
    getOpenGraphAlternateLocales,
  };
}
