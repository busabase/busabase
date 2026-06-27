import { match as localeMatch } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

/**
 * Detects the user's locale from the Accept-Language header (server-side).
 * Uses @formatjs/intl-localematcher for proper locale negotiation.
 *
 * @param supportedLocales - List of supported locales for the app
 * @param acceptLanguage - The Accept-Language header value
 * @param defaultLocale - Fallback locale (default: "en")
 */
export function detectServerLocaleFromHeader<T extends string>(
  supportedLocales: readonly T[],
  acceptLanguage: string | null,
  defaultLocale: T = "en" as T,
): T {
  if (!acceptLanguage) return defaultLocale;

  const negotiatorHeaders = { "accept-language": acceptLanguage };
  const languages = new Negotiator({ headers: negotiatorHeaders }).languages();

  try {
    return localeMatch(languages, [...supportedLocales], defaultLocale) as T;
  } catch {
    return defaultLocale;
  }
}
