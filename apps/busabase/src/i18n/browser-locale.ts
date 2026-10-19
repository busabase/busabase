import { detectBrowserLocale } from "openlib/i18n";

export function detectBusabaseBrowserLocale<L extends string>(
  supportedLocales: readonly L[],
): L | "en" {
  try {
    return detectBrowserLocale(supportedLocales);
  } catch (error) {
    // Linux WebKit can report POSIX locale "C", which is not a BCP 47 tag.
    if (error instanceof RangeError) return "en";
    throw error;
  }
}
