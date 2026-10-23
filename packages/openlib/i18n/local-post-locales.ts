/**
 * The locales a locally-authored (MDX) post really exists in, for its hreflang set.
 *
 * Feed the result to `generatePageMetadata({ availableLocales })`. fumadocs' `fallbackLanguage`
 * makes `getPage(slugs, "ja")` return the English file when no Japanese file exists, so a
 * non-null page is not proof of a translation; only a distinct `data` object is.
 *
 * This is the MDX-only entry point (insure, previewfile). Apps that also read Busabase CMS get
 * the same rule, plus the CMS probe, from busabase-cms-sdk's
 * `createCmsPostResolver({ supportedLocales, defaultLocale }).getAvailablePostLocales` — the
 * published SDK cannot import this private package, and MDX-only apps should not have to take
 * on the CMS SDK (and its Docker allowlist entries) for this one check.
 */
export interface LocalPostSource {
  getPage: (slugs: string[], locale: string) => { data: unknown } | undefined;
}

export const getLocalPostLocales = (
  source: LocalPostSource,
  supportedLocales: readonly string[],
  defaultLocale: string,
  slugs: string[],
): string[] => {
  const fallbackData = source.getPage(slugs, defaultLocale)?.data;
  return supportedLocales.filter((locale) => {
    const page = source.getPage(slugs, locale);
    if (!page) return false;
    return locale === defaultLocale || page.data !== fallbackData;
  });
};

/** The i18n facts a locale resolution needs — fumadocs' `I18nConfig` satisfies it. */
export interface LocalPageI18n {
  languages: readonly string[];
  defaultLanguage: string;
}

export interface LocalPageLocales {
  /** Locales that really have their own file for this page (fallback copies excluded). */
  availableLocales: string[];
  /**
   * The locale whose file is rendered at the requested URL: `lang` when it has its own file,
   * otherwise the default locale fumadocs falls back to. Feed it to both `canonicalLang` and
   * `contentLang` of `generateContentPageMetadata`.
   */
  contentLocale: string;
  /** True when `lang` has no file of its own and the default-locale file is served instead. */
  isLocaleFallback: boolean;
}

/**
 * Everything a locally-authored (MDX) page route needs to describe its locales honestly:
 * the hreflang set, which file is actually rendered, and whether this is a fallback. Shared by
 * the docs and release-notes routes (share-domains/cms) so every app gets the same rule blog
 * posts follow (PR #7652).
 */
export const getLocalPageLocales = (
  source: LocalPostSource,
  i18n: LocalPageI18n,
  slugs: string[],
  lang: string,
): LocalPageLocales => {
  const availableLocales = getLocalPostLocales(source, i18n.languages, i18n.defaultLanguage, slugs);
  const isLocaleFallback = !availableLocales.includes(lang);
  return {
    availableLocales,
    contentLocale: isLocaleFallback ? i18n.defaultLanguage : lang,
    isLocaleFallback,
  };
};
