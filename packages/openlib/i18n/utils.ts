import { i18n } from "./i18n";

// Lazy import for better compatibility with React Native
let match: typeof import("@formatjs/intl-localematcher").match | null = null;

async function _getMatch() {
  if (!match) {
    try {
      const module = await import("@formatjs/intl-localematcher");
      match = module.match;
    } catch (_error) {
      console.warn("[i18n] Failed to load @formatjs/intl-localematcher, using fallback");
    }
  }
  return match;
}

/**
 * Simple fallback locale matcher for environments where @formatjs/intl-localematcher doesn't work
 */
function fallbackMatch(
  languages: string[],
  locales: readonly string[],
  defaultLocale: string,
): string {
  // Try exact match first
  for (const lang of languages) {
    if (locales.includes(lang)) {
      return lang;
    }
  }

  // Try language code without region (e.g., 'zh' from 'zh-CN')
  for (const lang of languages) {
    const langCode = lang.split("-")[0];
    const matched = locales.find((l) => l.startsWith(langCode));
    if (matched) {
      return matched;
    }
  }

  return defaultLocale;
}

export function matchLocale(languages: string[]): string {
  try {
    // Try to use @formatjs/intl-localematcher synchronously first (for web/node)
    const { match: syncMatch } = require("@formatjs/intl-localematcher");
    return syncMatch(languages, i18n.locales, i18n.defaultLocale);
  } catch (_error) {
    // Fallback for React Native or when the module is not available
    return fallbackMatch(languages, i18n.locales, i18n.defaultLocale);
  }
}
