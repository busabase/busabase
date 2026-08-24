/**
 * `.busabaseignore` — which files inside an AirApp directory stay in the repo
 * instead of being installed into the node.
 *
 * Why an ignore file exists at all: an AirApp node IS the project (nodepod runs
 * `npm run dev` against exactly what the node contains), so `content/<airapp>/`
 * has to be both the deployable artefact and the directory a developer works in.
 * Without a way to exclude `test/`, lockfiles and coverage, the only alternative
 * is a second copy of the source — which is precisely the duplication the
 * template format exists to remove.
 *
 * **Supported subset of gitignore syntax**, deliberately small and stated here
 * so authors are never surprised by a silent near-miss:
 *
 * | Pattern | Meaning |
 * | --- | --- |
 * | `# comment`, blank line | ignored |
 * | `test/` | that directory and everything under it |
 * | `coverage` | a file OR directory with this name, at any depth |
 * | `/build` | anchored to the AirApp root only |
 * | `*.log` | `*` matches within one path segment |
 * | `docs/**\/*.tmp` | `**` matches across segments |
 * | `!keep.log` | negation — re-includes a path an earlier rule excluded |
 *
 * NOT supported: character classes (`[a-z]`), escaped literals (`\#`). A pattern
 * using them is matched literally rather than being silently reinterpreted.
 *
 * Last matching rule wins, exactly like gitignore, which is what makes `!`
 * useful after a broad exclude.
 */

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  /** `test/` may only match a directory (or something inside one). */
  directoryOnly: boolean;
}

const escapeLiteral = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/**
 * Translate one gitignore-ish pattern into a regex over a POSIX relative path.
 *
 * The three globs are handled in one pass so that `**` is recognised before the
 * `*` it starts with — splitting on `*` first would turn `**` into two
 * segment-local wildcards and quietly stop matching across directories.
 */
const patternToRegex = (pattern: string, anchored: boolean): RegExp => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        // `a/**/b` must also match `a/b`, so consume the following slash too.
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if (char === "/") {
      source += "/";
      continue;
    }
    source += escapeLiteral(char);
  }
  // An unanchored pattern matches at any depth: `coverage` hits `a/b/coverage`.
  const prefix = anchored ? "^" : "^(?:.*/)?";
  // A match on the path itself OR on any ancestor segment of it, so excluding
  // `test` also excludes `test/unit/a.mjs` without the author writing `test/**`.
  return new RegExp(`${prefix}${source}(?:/.*)?$`);
};

const parseRule = (line: string): IgnoreRule | undefined => {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return undefined;
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  if (!pattern) return undefined;
  return { regex: patternToRegex(pattern, anchored), negated, directoryOnly };
};

export interface IgnoreMatcher {
  /** True when `relativePath` (POSIX, no leading slash) must not be installed. */
  ignores: (relativePath: string) => boolean;
  /** Whether any rule was parsed — an empty/comment-only file ignores nothing. */
  isEmpty: boolean;
}

export const parseIgnoreFile = (contents: string): IgnoreMatcher => {
  const rules = contents
    .split(/\r?\n/)
    .map(parseRule)
    .filter((rule): rule is IgnoreRule => rule !== undefined);

  return {
    isEmpty: rules.length === 0,
    ignores: (relativePath: string): boolean => {
      let ignored = false;
      for (const rule of rules) {
        // A file entry can still satisfy a `dir/` rule by living inside it —
        // the regex already covers that via its `(?:/.*)?$` tail, so the only
        // thing to reject here is the directory name matching the file itself.
        if (rule.directoryOnly && !rule.regex.test(`${relativePath}/`)) continue;
        if (!rule.regex.test(relativePath)) continue;
        ignored = !rule.negated;
      }
      return ignored;
    },
  };
};

/** A matcher that installs everything — used when no ignore file is present. */
export const IGNORE_NOTHING: IgnoreMatcher = { ignores: () => false, isEmpty: true };
