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
