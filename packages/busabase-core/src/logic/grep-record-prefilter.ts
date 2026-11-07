/**
 * Records-grep prefilter: the literal(s) a record's HEAD commit must contain
 * for the grep pattern to have any chance of matching it, so Postgres can rule
 * a record out (`strpos(payload::text, token) > 0`) before its payload is sent
 * to the app and regex-scanned. Derived only when that is provably safe; `null`
 * means "no prefilter" and the records adapter scans every candidate as before.
 *
 * Soundness is the whole contract: the adapter regex-scans each field's
 * FLATTENED text (`flattenFieldValue` in `logic/grep.ts`), while Postgres
 * searches the jsonb's TEXT rendering. A token is used only when "the regex
 * matches a line of some flattened field" implies "the token occurs in
 * `payload::text`". Every way the two texts differ, and the rule that keeps a
 * token clear of it:
 *
 * 1. Pattern shape. Only a pure literal (`isLiteralPattern`: no JS regex
 *    metacharacter, so no `\`, `.`, `[`, `(`, …) or a top-level alternation of
 *    pure literals (`a|b|c`) — then the regex matches a line exactly when the
 *    line contains one of the literals. An empty alternative (`a|`, `|`)
 *    matches every line, so it gets no prefilter.
 * 2. Flags. Only `""` and `"i"` (what `compileGrepPattern` keeps). Any other
 *    flag on the compiled regex — `u` changes case folding — disables it.
 * 3. String escaping. Strings are flattened raw but JSON-escaped inside
 *    `payload::text`, so a token is used only when escaping leaves it unchanged
 *    (`JSON.stringify(token).slice(1, -1) === token`): no `"`, `\`, control
 *    character (which also covers newlines — a line never contains one) or
 *    lone surrogate.
 * 4. JSON spacing. `json` fields and unexpected objects are flattened with
 *    `JSON.stringify` (`{"a":1}`, `["x","y"]`) while jsonb renders
 *    `{"a": 1}` / `["x", "y"]`: a token with `"`, `:`, `,`, `{`, `}`, `[` or
 *    `]` could span that structure, so it gets no prefilter. A token without
 *    them can only sit inside one string, number or `true`/`false`/`null`.
 * 5. Array joins. Other arrays are flattened with `join(", ")`, but jsonb
 *    quotes each element: a token with `,` could span two elements (rule 4),
 *    and a token that starts with a space could begin at the separator's space
 *    and run into the next element, which jsonb opens with `"`.
 * 6. Numbers. Numbers are flattened with `String(n)`, which can differ from
 *    jsonb's numeric text: exponent form (`1e+21` vs
 *    `1000000000000000000000`, `1e-7` vs `0.0000001`) and rounding past 15
 *    significant digits (`12345678901234567891` reads back as
 *    `12345678901234567000`). Even plain digit runs are affected — `21` occurs
 *    in `1e+21` but not in `1000000000000000000000`. A number is the whole
 *    line or is delimited by structure (rules 4–5), so a token can overlap one
 *    only by lying inside it. A literal has no `.` or `+`, so the parts of
 *    `String(n)` it can lie inside all fit `-?digits(e(-digits)?)?` — `2024`,
 *    `-7`, `1e`, `e-7`, `e` get no prefilter (`E` too: `i` folds it to `e`).
 *    `2024-01-15`, `10-20` or `e2e` cannot occur in any `String(n)` (its `-`
 *    only follows `e`, its `e` is always followed by a sign), so they keep it.
 * 7. Objects inside arrays. `join` renders an object element as
 *    `[object Object]`, text that is not in the payload at all: a token that
 *    occurs inside `object Object` gets no prefilter.
 * 8. Case-insensitive (`i`). JS non-unicode `/i` folds every ASCII letter
 *    only with its ASCII counterpart, and folds some non-ASCII code units
 *    (`é`/`É`, fullwidth `ａ`/`Ａ`, …) too. Postgres compares against
 *    `lower(payload::text collate "C")`, which folds ASCII only, using the
 *    ASCII-lowered token. So under `i` a token is used only when every
 *    non-ASCII code unit in it is one `/i` folds with nothing else (CJK,
 *    kana, digits, most punctuation); otherwise no prefilter.
 *
 * 9. Payload shape. Grep reads `payload[slug]`. A record payload is a
 *    slug → value object, so that is one of its values. Were it any other
 *    jsonb, a slug (`[a-z0-9-]+`) still reaches only an element or a
 *    character of it, `length` (a number — rule 6) or a prototype method,
 *    which flattens to nothing; no separate guard is needed.
 *
 * Anything the payload contains beyond the flattened fields (keys, deleted
 * fields, attachments) can only make Postgres keep a record the regex then
 * rejects — never the reverse.
 */
import { isLiteralPattern } from "../domains/assets/logic/asset-grep-logic";

export interface RecordPrefilter {
  /**
   * A record can match only if `payload::text` contains at least one of these
   * (ASCII-lowered when `caseInsensitive`). Never empty.
   */
  tokens: string[];
  /** Compare against `lower(payload::text collate "C")` instead of the text as is. */
  caseInsensitive: boolean;
}

/** Rules 4–5: characters of jsonb/JSON/join structure. */
const STRUCTURAL_CHARS = /[",:{}[\]]/;
/**
 * Rule 6: could lie inside a `String(n)` — the literal's possible pieces of
 * `-1.5e-7` / `1e+21` once `.` and `+` (regex metacharacters) are excluded.
 */
const INSIDE_NUMBER_RENDERING = /^-?[0-9]*(?:[eE](?:-[0-9]*)?)?$/;
/** Rule 7: what `join` writes for an object element (brackets are rule 4's). */
const OBJECT_ELEMENT_TEXT = "object Object";

const lowerAscii = (value: string): string =>
  value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));

/**
 * The spec's `Canonicalize` for a non-unicode `/i` regex: two code units match
 * each other exactly when they canonicalize to the same unit.
 */
const canonicalize = (unit: number): number => {
  const upper = String.fromCharCode(unit).toUpperCase();
  if (upper.length !== 1) return unit;
  const canonical = upper.charCodeAt(0);
  return unit >= 128 && canonical < 128 ? unit : canonical;
};

let nonAsciiFoldingUnits: Set<number> | undefined;

/**
 * Every non-ASCII code unit `/i` treats as equal to some OTHER code unit — the
 * ones `lower(… collate "C")` would not fold. Built once, on first use.
 */
const foldingNonAsciiUnits = (): Set<number> => {
  if (nonAsciiFoldingUnits) return nonAsciiFoldingUnits;
  const byCanonical = new Map<number, number[]>();
  for (let unit = 0; unit <= 0xffff; unit++) {
    const canonical = canonicalize(unit);
    const group = byCanonical.get(canonical);
    if (group) group.push(unit);
    else byCanonical.set(canonical, [unit]);
  }
  const folding = new Set<number>();
  for (const group of byCanonical.values()) {
    if (group.length < 2) continue;
    for (const unit of group) if (unit >= 128) folding.add(unit);
  }
  nonAsciiFoldingUnits = folding;
  return folding;
};

/** Rule 8: under `i`, every non-ASCII code unit must fold with nothing else. */
const foldsOnlyAscii = (token: string): boolean => {
  const folding = foldingNonAsciiUnits();
  for (let index = 0; index < token.length; index++) {
    const unit = token.charCodeAt(index);
    if (unit >= 128 && folding.has(unit)) return false;
  }
  return true;
};

/** Rules 3–8 for one literal; the SQL form of the token, or `null` when it is unsafe. */
const prefilterToken = (literal: string, caseInsensitive: boolean): string | null => {
  if (JSON.stringify(literal).slice(1, -1) !== literal) return null;
  if (STRUCTURAL_CHARS.test(literal)) return null;
  if (literal.startsWith(" ")) return null;
  if (INSIDE_NUMBER_RENDERING.test(literal)) return null;
  const folded = caseInsensitive ? lowerAscii(literal) : literal;
  if ((caseInsensitive ? lowerAscii(OBJECT_ELEMENT_TEXT) : OBJECT_ELEMENT_TEXT).includes(folded)) {
    return null;
  }
  if (caseInsensitive && !foldsOnlyAscii(literal)) return null;
  return folded;
};

/**
 * The prefilter for `pattern` as compiled into `regex` (`compileGrepPattern`),
 * or `null` when none is provably safe — see the module doc for every rule.
 */
export const deriveRecordPrefilter = (pattern: string, regex: RegExp): RecordPrefilter | null => {
  if (regex.flags !== "" && regex.flags !== "i") return null;
  const caseInsensitive = regex.flags === "i";
  const tokens: string[] = [];
  for (const literal of pattern.split("|")) {
    if (literal.length === 0 || !isLiteralPattern(literal)) return null;
    const token = prefilterToken(literal, caseInsensitive);
    if (token === null) return null;
    tokens.push(token);
  }
  // A token containing another one adds nothing: any payload with it has the other one too.
  const unique = [...new Set(tokens)];
  const needed = unique.filter(
    (token) => !unique.some((other) => other !== token && token.includes(other)),
  );
  return { tokens: needed, caseInsensitive };
};
