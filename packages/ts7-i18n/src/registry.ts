import type { LL, Translatable } from "./typed-translations";

/**
 * A `{{…}}` plural block's forms, in the order typesafe-i18n's shorthand
 * declares them. `other` is always present; the rest are optional.
 */
interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Splits a `{{…}}` block's inner content into `{ key, forms }`, matching
 * typesafe-i18n's shorthand exactly:
 *
 * - `{{s}}`                       → 1 form  → `other: "s"` (so singular renders "")
 * - `{{item|items}}`              → 2 forms → `one`, `other`
 * - `{{none|one|many}}`           → 3 forms → `zero`, `one`, `other`
 * - `{{z|o|t|f|m|r}}`             → 6 forms → all categories
 * - `{{count:item|items}}`        → explicit key instead of the preceding param
 */
function parsePluralBlock(
  content: string,
  lastKey: string | undefined,
): { key: string | undefined; forms: PluralForms } {
  const separatorIndex = content.indexOf(":");
  const key = separatorIndex === -1 ? lastKey : content.slice(0, separatorIndex).trim();
  const rawForms = separatorIndex === -1 ? content : content.slice(separatorIndex + 1);
  const entries = rawForms.split("|").map((entry) => entry.trim());

  if (entries.length === 1) return { key, forms: { other: entries[0] as string } };
  if (entries.length === 2) return { key, forms: { one: entries[0], other: entries[1] as string } };
  if (entries.length === 3) {
    return { key, forms: { zero: entries[0], one: entries[1], other: entries[2] as string } };
  }
  // 4 and 5 forms have no shorthand of their own; like typesafe-i18n, they fill
  // this 6-slot layout as far as they go. `other` must still be a string —
  // `entries[5]` is undefined for those, and every caller does `.replace()` on
  // the result, so defaulting to "" here is what keeps a 4-form block from
  // throwing at render time. Verified against typesafe-i18n: it renders "" too.
  return {
    key,
    forms: {
      zero: entries[0],
      one: entries[1],
      two: entries[2],
      few: entries[3],
      many: entries[4],
      other: entries[5] ?? "",
    },
  };
}

/** Picks a plural form for `value` using the locale's own `Intl.PluralRules` categories. */
function selectPluralForm(forms: PluralForms, value: unknown, locale: string): string {
  if (typeof value === "boolean") return (value ? forms.one : forms.other) ?? "";

  const numeric = Number(value);
  // An explicit `zero` form wins for exactly 0 even in locales (like `en`)
  // whose plural rules have no `zero` category.
  const category =
    forms.zero !== undefined && numeric === 0
      ? "zero"
      : new Intl.PluralRules(locale).select(numeric);

  switch (category) {
    case "zero":
      return forms.zero ?? "";
    case "one":
      return forms.one ?? "";
    case "two":
      return forms.two ?? "";
    case "few":
      return forms.few ?? forms.other;
    case "many":
      return forms.many ?? forms.other;
    default:
      return forms.other;
  }
}

// `{{…}}` (plural) is matched before `{…}` (parameter) so a plural block is
// never mistaken for a parameter named after its first form.
const PART_PATTERN = /\{\{(.*?)\}\}|\{(\w+)(?::\w+)?\}/g;

/**
 * Substitutes `{param}` / `{param:type}` placeholders and `{{…}}` plural blocks.
 * Unmatched parameter placeholders are left as literal text.
 *
 * A plural block with no explicit `key:` binds to the nearest *preceding*
 * parameter, falling back to the first parameter in the string — the same rule
 * typesafe-i18n uses, so migrated strings render identically. `??` inside a
 * plural form is replaced with the bound value.
 */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
  locale = "en",
): string {
  // The nearest preceding parameter, tracked as we scan left to right.
  let lastKey: string | undefined;
  // Fallback for a plural block that appears before any parameter.
  let firstKey: string | undefined;
  for (const match of template.matchAll(PART_PATTERN)) {
    const parameterKey = match[2];
    if (parameterKey !== undefined) {
      firstKey = parameterKey;
      break;
    }
  }

  return template.replace(PART_PATTERN, (whole, pluralContent?: string, parameterKey?: string) => {
    if (parameterKey !== undefined) {
      lastKey = parameterKey;
      return params && parameterKey in params ? String(params[parameterKey]) : whole;
    }

    const { key, forms } = parsePluralBlock(pluralContent ?? "", lastKey ?? firstKey);
    const value = key !== undefined ? params?.[key] : undefined;
    return selectPluralForm(forms, value, locale).replace(/\?\?/g, String(value));
  });
}

function buildLL<T extends object>(tree: Translatable<T>, locale: string): LL<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] =
      typeof value === "string"
        ? (params?: Record<string, string | number>) => interpolate(value, params, locale)
        : buildLL(value as Translatable<object>, locale);
  }
  return out as LL<T>;
}

export interface TranslationRegistry<Locale extends string, T extends object> {
  /** Registers (or replaces) a locale's translation tree. */
  loadLocale: (locale: Locale, translations: Translatable<T>) => void;
  /** Whether `loadLocale` has been called for `locale`. */
  isLocaleLoaded: (locale: Locale) => boolean;
  /** Returns the `LL` accessor for an already-loaded `locale`. Throws if not loaded. */
  getTranslations: (locale: Locale) => LL<T>;
}

/**
 * Builds the locale-registration/lookup half of a typed i18n system — no React
 * dependency at all, so it's safe to import from anywhere: Server Components,
 * middleware, server actions, plain Node scripts. For the React `Provider` /
 * `useI18nContext` half, see `ts7-i18n/react`'s `createI18nReactBindings`, which
 * takes the `TranslationRegistry` this function returns.
 *
 * (Why two entry points instead of one `createTypedI18n`: bundlers that enforce
 * a Server/Client Component boundary — e.g. Next.js App Router — statically flag
 * any file that imports `react`'s `createContext`, even if nothing on the
 * import path from a Server Component ever calls it. Keeping the registry in a
 * React-free module lets Server Components import `getTranslations` directly.)
 */
export function createTranslationRegistry<Locale extends string, T extends object>(
  initialTranslations: Partial<Record<Locale, Translatable<T>>> = {},
): TranslationRegistry<Locale, T> {
  const registry: Partial<Record<Locale, Translatable<T>>> = { ...initialTranslations };

  function loadLocale(locale: Locale, translations: Translatable<T>): void {
    registry[locale] = translations;
  }

  function isLocaleLoaded(locale: Locale): boolean {
    return locale in registry;
  }

  function getTranslations(locale: Locale): LL<T> {
    const translations = registry[locale];
    if (!translations) {
      throw new Error(
        `ts7-i18n: locale "${locale}" is not loaded — call loadLocale("${locale}", ...) before use.`,
      );
    }
    return buildLL<T>(translations, locale);
  }

  return { loadLocale, isLocaleLoaded, getTranslations };
}
