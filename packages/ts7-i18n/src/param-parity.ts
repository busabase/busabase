// Must stay in sync with `PART_PATTERN` in ./registry.ts: `{{…}}` is matched
// before `{…}` so a plural block is never counted as a parameter named after
// its first form (e.g. `hour{{s}}` must not report a param `s`).
const PART_PATTERN = /\{\{(.*?)\}\}|\{(\w+)(?::\w+)?\}/g;

/**
 * Walks a (possibly nested) translation tree and collects, per dotted key path,
 * the set of parameter names each string leaf references.
 *
 * A `{{…}}` plural block contributes a name only in its explicit
 * `{{key:one|other}}` form; the common `{{s}}` / `{{a|b}}` form binds to the
 * nearest preceding `{param}`, which is already counted from that parameter.
 */
export function collectParams(tree: unknown, path = ""): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  function walk(node: unknown, currentPath: string): void {
    if (typeof node === "string") {
      const params = new Set<string>();
      for (const match of node.matchAll(PART_PATTERN)) {
        const pluralContent = match[1];
        const parameterKey = match[2];
        if (parameterKey !== undefined) {
          params.add(parameterKey);
          continue;
        }
        const separatorIndex = (pluralContent ?? "").indexOf(":");
        if (separatorIndex !== -1) {
          params.add((pluralContent as string).slice(0, separatorIndex).trim());
        }
      }
      result[currentPath] = [...params].sort();
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, currentPath ? `${currentPath}.${key}` : key);
      }
    }
  }

  walk(tree, path);
  return result;
}

/**
 * Asserts every locale in `locales` references exactly the same `{param}` set,
 * at every key path, as `base` does. TypeScript's type system cannot compare two
 * independent string literals' extracted param sets across files — this is a
 * runtime check, meant to run once in each app's own test suite, not a compile-time
 * guarantee. Throws (with a readable per-path diff) on any mismatch.
 */
export function assertLocaleParamParity(base: object, locales: Record<string, object>): void {
  const baseParams = collectParams(base);
  const mismatches: string[] = [];

  for (const [localeName, tree] of Object.entries(locales)) {
    const localeParams = collectParams(tree);
    for (const [path, params] of Object.entries(baseParams)) {
      const otherParams = localeParams[path] ?? [];
      const missing = params.filter((p) => !otherParams.includes(p));
      const extra = otherParams.filter((p) => !params.includes(p));
      if (missing.length > 0 || extra.length > 0) {
        mismatches.push(
          `[${localeName}] "${path}": missing [${missing.join(", ")}], extra [${extra.join(", ")}]`,
        );
      }
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`ts7-i18n: locale parameter mismatch:\n${mismatches.join("\n")}`);
  }
}
