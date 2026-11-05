/**
 * Test helper: the server entry points of an app's `[lang]` tree do not crash on a first segment
 * that is not a locale. docs/seo-standard.md rule 9.
 *
 * A path the proxy matcher skips (`/x.png`, `/assets/about`) reaches the tree with `lang` set to
 * that segment. Guarding the root layout is not enough: Next renders the layouts and the page
 * concurrently, and a crash in any of them turns the root layout's 404 into a 500.
 *
 * Calling an entry as a function runs its own body, not the components it returns. So an entry
 * named in `mustReject` also fails when it reads `lang` and returns normally: it hands the value to
 * a component this test cannot see. Name every entry that does, and the root layout.
 */
import { describe, expect, it } from "vitest";

export const UNKNOWN_LANG = "zz-seo-check-missing.png";
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";
const REDIRECT_DIGEST = "NEXT_REDIRECT";

type Entry = (props: unknown) => unknown;
interface EntryModule {
  default?: Entry;
  generateMetadata?: Entry;
}

/** What one exported function does with an unknown `lang`; null is correct. */
export const judgeEntry = async (
  entry: Entry,
  { mustReject = false }: { mustReject?: boolean } = {},
): Promise<string | null> => {
  let readLang = false;
  const params = {
    get lang() {
      readLang = true;
      return UNKNOWN_LANG;
    },
    slug: undefined,
  };
  try {
    await entry({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
      children: null,
    });
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith(NOT_FOUND_DIGEST)) return null;
    // Next lets the root layout's 404 win over a page's redirect.
    if (!mustReject && typeof digest === "string" && digest.startsWith(REDIRECT_DIGEST))
      return null;
    return `crashed: ${String(error)}`;
  }
  return mustReject && readLang
    ? "read lang and returned normally; call requireLocale on it"
    : null;
};

const CLIENT_MODULE = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/;

/**
 * `entries` and `sources` are `import.meta.glob` of the app's `[lang]` pages and layouts, as a
 * module and `?raw`. A client module is skipped: it runs below the server layout that guards it.
 */
export const describeUnknownLangEntries = (
  entries: Record<string, () => Promise<unknown>>,
  sources: Record<string, unknown>,
  { mustReject = [] }: { mustReject?: readonly string[] | "all" } = {},
): void => {
  describe("[lang] entry points survive a first segment that is not a locale", () => {
    const paths = Object.keys(entries).filter(
      (path) => !CLIENT_MODULE.test(String(sources[path] ?? "")),
    );

    it("finds the entry points, and every one named in mustReject", () => {
      expect(paths.length).toBeGreaterThan(0);
      if (mustReject !== "all") {
        expect(mustReject.filter((path) => !paths.includes(path))).toEqual([]);
      }
    });

    for (const path of paths) {
      it(path, { timeout: 120_000 }, async () => {
        const entry = (await entries[path]?.()) as EntryModule;
        const options = { mustReject: mustReject === "all" || mustReject.includes(path) };
        const problems: Record<string, string> = {};
        for (const name of ["generateMetadata", "default"] as const) {
          const fn = entry[name];
          const problem = fn ? await judgeEntry(fn, options) : null;
          if (problem) problems[name] = problem;
        }
        expect(problems).toEqual({});
      });
    }
  });
};
