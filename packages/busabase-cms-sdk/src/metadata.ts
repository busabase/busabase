/**
 * "What the CMS actually has" for one content item, in the shape a page `<head>` needs.
 *
 * This SDK owns the FACTS about a piece of content — which locales really have it, which
 * locale the rendered body is, the editor's SEO fields — and hands them over as one plain
 * object. How those facts become `<head>` tags (canonical URL, hreflang, OpenGraph) is the
 * app's metadata helper's job. The field names deliberately match that helper's options
 * (`title`, `description`, `path`, `lang`, `canonicalLang`, `contentLang`,
 * `availableLocales`, `absoluteTitle`), so a route can spread the object straight in:
 *
 * ```ts
 * const input = await resolver.resolvePostMetadataInput(lang, slugPath);
 * if (!input) return notFoundMetadata;
 * return generateContentPageMetadata({ ...input, type: "article" });
 * ```
 *
 * Pure and dependency-free, so it is safe from any runtime.
 */
export interface CmsContentMetadataInput {
  /** `seo-title` when an editor wrote one, else the content title. */
  title: string;
  /** `seo-description`, else the content description, else `""`. */
  description: string;
  /**
   * `true` exactly when `title` is an editor-authored `seo-title`. That is a COMPLETE title,
   * brand included, and must bypass the app's `title.template`; a plain title is a fragment
   * and still gets the template. Same rule `generateCmsPageMetadata` applies to Pages.
   */
  absoluteTitle: boolean;
  /** Canonical path WITHOUT a locale prefix, e.g. `/blog/hello-world`. */
  path: string;
  /** The locale the visitor requested — picks the request URL. */
  lang: string;
  /** The locale of the content that exists; the canonical URL points here. */
  canonicalLang: string;
  /** The locale the rendered body really is; drives `og:locale`. */
  contentLang: string;
  /**
   * The locales that really have this item — its own CMS record or its own local file, never
   * a fumadocs `fallbackLanguage` copy — in the app's locale order. Always contains
   * `contentLang`, so a CMS outage cannot strip the page's own self-reference.
   */
  availableLocales: string[];
  /**
   * The CMS cover image (or the local post's `image`), when there is one. openlib's
   * `generateContentPageMetadata` reads this same option name and uses it as the share
   * image when the route passes no explicit `imageUrl`, so spreading this object is
   * enough to put a post's cover on its share card.
   */
  coverImageUrl?: string;
}

/** The CMS fields `buildCmsContentMetadataInput` reads — structurally a slice of `PostVO`. */
export interface CmsContentMetadataFields {
  title: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  coverImage?: { url: string } | null;
}

/** Title/description/image of content that did NOT come from the CMS (local MDX, etc.). */
export interface LocalContentMetadataFields {
  title?: string | null;
  description?: string | null;
  image?: string | null;
}

export interface BuildCmsContentMetadataInputOptions {
  requestedLocale: string;
  contentLocale: string;
  canonicalPath: string;
  /** Locales that really have the item. `contentLocale` is added if missing. */
  availableLocales: readonly string[];
  /** The CMS record, when the content came from Busabase CMS. */
  cms?: CmsContentMetadataFields | null;
  /** The non-CMS content, when it did not. Ignored when `cms` is set. */
  local?: LocalContentMetadataFields | null;
}

/**
 * Assemble a `CmsContentMetadataInput` from already-resolved content. Use it when an app
 * resolves content itself (e.g. with an extra non-CMS source layered on top); apps using
 * `createCmsPostResolver` get the same object from `resolvePostMetadataInput` directly.
 */
export const buildCmsContentMetadataInput = ({
  requestedLocale,
  contentLocale,
  canonicalPath,
  availableLocales,
  cms,
  local,
}: BuildCmsContentMetadataInputOptions): CmsContentMetadataInput => {
  const coverImageUrl = cms ? cms.coverImage?.url : (local?.image ?? undefined);
  return {
    title: cms ? (cms.seoTitle ?? cms.title) : (local?.title ?? ""),
    description: cms ? (cms.seoDescription ?? cms.description ?? "") : (local?.description ?? ""),
    absoluteTitle: Boolean(cms?.seoTitle),
    path: canonicalPath,
    lang: requestedLocale,
    canonicalLang: contentLocale,
    contentLang: contentLocale,
    availableLocales: availableLocales.includes(contentLocale)
      ? [...availableLocales]
      : [...availableLocales, contentLocale],
    ...(coverImageUrl ? { coverImageUrl } : {}),
  };
};
