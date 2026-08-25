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
 *
 * The repetitive `if` chain is deliberate — do not "simplify" it into a
 * slots-lookup table. That was tried and measured: it saves ~28 B gzip but
 * costs ~15% throughput (29x → 24x against v1.0.0), because each branch here
 * returns a fixed-shape object literal the engine can give a stable hidden
 * class, while a loop assigning dynamic keys produces a different shape per
 * block length.
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

// `new Intl.PluralRules(locale)` is comparatively expensive to construct, and
// the result only depends on the locale — so build one per locale, not one per
// plural substitution.
const pluralRulesByLocale = new Map<string, Intl.PluralRules>();

function pluralRulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRulesByLocale.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesByLocale.set(locale, rules);
  }
  return rules;
}

/** Picks a plural form for `value` using the locale's own `Intl.PluralRules` categories. */
function selectPluralForm(forms: PluralForms, value: unknown, locale: string): string {
  if (typeof value === "boolean") return (value ? forms.one : forms.other) ?? "";

  const numeric = Number(value);
  // An explicit `zero` form wins for exactly 0 even in locales (like `en`)
  // whose plural rules have no `zero` category.
  const category =
    forms.zero !== undefined && numeric === 0 ? "zero" : pluralRulesFor(locale).select(numeric);

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
 * A template split into literal text and the placeholders between it. Parsing a
 * template into this shape is the expensive half of interpolation (regex scan +
 * plural-block splitting), and it depends only on the template string — so it
 * is done once per string rather than once per call. See `compile`.
 */
type TemplatePart =
  | string
  | { kind: "param"; key: string; raw: string }
  | { kind: "plural"; key: string | undefined; forms: PluralForms };

const RE_PLURAL_VALUE = /\?\?/g;

/**
 * Parses a template into its `TemplatePart[]` once. The plural-binding rules
 * (nearest *preceding* parameter, falling back to the first parameter in the
 * string) are resolved here, at parse time, so rendering is a pure walk.
 */
function compile(template: string): TemplatePart[] {
  // Fast path for plain text — no placeholders at all, which is ~94% of a real
  // translation tree. Skips both `matchAll` scans below and lets `buildLL` hand
  // back a constant-returning closure.
  //
  // Uses `search` rather than `PART_PATTERN.test`: the pattern is `/g`, so
  // `test` advances its `lastIndex` and would desynchronise the `matchAll`
  // scans that follow (this broke 24 tests when written that way).
  if (template.search(PART_PATTERN) === -1) return [template];

  // Fallback for a plural block that appears before any parameter.
  let firstKey: string | undefined;
  for (const match of template.matchAll(PART_PATTERN)) {
    if (match[2] !== undefined) {
      firstKey = match[2];
      break;
    }
  }

  const parts: TemplatePart[] = [];
  // The nearest preceding parameter, tracked as we scan left to right.
  let lastKey: string | undefined;
  let cursor = 0;

  for (const match of template.matchAll(PART_PATTERN)) {
    const index = match.index;
    if (index > cursor) parts.push(template.slice(cursor, index));
    cursor = index + match[0].length;

    const parameterKey = match[2];
    if (parameterKey !== undefined) {
      lastKey = parameterKey;
      parts.push({ kind: "param", key: parameterKey, raw: match[0] });
      continue;
    }

    const { key, forms } = parsePluralBlock(match[1] ?? "", lastKey ?? firstKey);
    parts.push({ kind: "plural", key, forms });
  }

  if (cursor < template.length) parts.push(template.slice(cursor));
  return parts;
}

// Compiled templates are cached by string identity. Translation trees are
// finite and long-lived, so this is bounded by the size of the loaded locales.
const compiledTemplates = new Map<string, TemplatePart[]>();

function compiledFor(template: string): TemplatePart[] {
  let parts = compiledTemplates.get(template);
  if (!parts) {
    parts = compile(template);
    compiledTemplates.set(template, parts);
  }
  return parts;
}

/** Renders pre-compiled parts. Pure string work — no parsing, no allocation of regexes. */
function render(
  parts: TemplatePart[],
  params: Record<string, string | number> | undefined,
  locale: string,
): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") {
      out += part;
    } else if (part.kind === "param") {
      out += params && part.key in params ? String(params[part.key]) : part.raw;
    } else {
      const value = part.key !== undefined ? params?.[part.key] : undefined;
      out += selectPluralForm(part.forms, value, locale).replace(RE_PLURAL_VALUE, String(value));
    }
  }
  return out;
}

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
  return render(compiledFor(template), params, locale);
}

function buildLL<T extends object>(tree: Translatable<T>, locale: string): LL<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      // Compile once, when the accessor is built — not on every call. The
      // closure keeps the parsed parts, so invoking `LL.some.key(params)` is a
      // walk over an array, with no regex work left to do.
      const parts = compiledFor(value);
      // The overwhelming majority of a real translation tree is plain text with
      // no placeholders at all (~94% of the strings across the apps this was
      // extracted from). Those compile to a single literal part, so hand back a
      // closure that just returns it — no loop, no `params` handling.
      const only = parts.length === 1 ? parts[0] : undefined;
      out[key] =
        typeof only === "string"
          ? () => only
          : (params?: Record<string, string | number>) => render(parts, params, locale);
    } else {
      out[key] = buildLL(value as Translatable<object>, locale);
    }
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
