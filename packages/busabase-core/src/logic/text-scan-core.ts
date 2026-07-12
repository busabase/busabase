import "server-only";

/**
 * Source-neutral scanner core for Unified Grep (see
 * apps/busabase/content/spec/unified-grep.md, P2a). Extracted verbatim (same
 * behavior, no semantic change) from `domains/assets/logic/asset-grep-logic.ts`'s
 * `compileGrepPattern` + `scanLinesForMatches`, which the Drive Grep Retrieval
 * (P0/P1) spec built as a source-agnostic pattern compiler + per-line scanner
 * in all but its input/output types — this file removes that last coupling.
 *
 * Every source adapter (files: `asset-grep-logic.ts`'s `grepAssets`; Docs:
 * `logic/grep.ts`'s docs adapter; a future records adapter in P2b) compiles
 * its pattern through `compileGrepPattern` and feeds its own line iterable
 * through `scanLines`, then wraps the returned `LineHit[]` with its own
 * addressing (assetId/fileName/drivePath for files, nodeId/slug/name for
 * Docs, etc.) — "one pattern language everywhere" (spec's Interaction-First
 * Principle #1).
 */
import { ORPCError } from "@orpc/server";

// ── Pattern compilation + ReDoS guards ──────────────────────────────────────

const MAX_PATTERN_LENGTH = 500;

// A crude but effective heuristic for classic catastrophic-backtracking shapes:
// a quantified group directly re-quantified, e.g. `(a+)+`, `(a*)*`, `(a+){2,}`.
const CATASTROPHIC_PATTERN_HINT = /\([^()]*[+*][^()]*\)[+*]|\([^()]*[+*][^()]*\)\{\d*,/;

/**
 * The other classic catastrophic-backtracking shape: a quantified group whose
 * alternation branches overlap — one is a prefix of another, or two are
 * identical — e.g. `(a|a)*`, `(a|aa)*`. Detected structurally (split the
 * group body on unescaped `|`, compare branches) rather than flagging ANY
 * quantified alternation, which would false-positive on ordinary, safe
 * patterns like `(cat|dog)*` or `(foo|bar){2,5}` (their branches share no
 * prefix relationship, so they can't blow up the same way).
 *
 * Same scope limitation as `CATASTROPHIC_PATTERN_HINT`: only looks at groups
 * with no nested parens (`[^()]*`) — a crude-but-effective heuristic, not a
 * full regex parser.
 */
const hasOverlappingQuantifiedAlternation = (pattern: string): boolean => {
  const groupWithQuantifier = /\(([^()]*)\)(?:[+*]|\{\d*,)/g;
  for (const match of pattern.matchAll(groupWithQuantifier)) {
    const body = match[1];
    if (!body.includes("|")) continue;
    const branches = body.split(/(?<!\\)\|/).filter((branch) => branch.length > 0);
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        const a = branches[i];
        const b = branches[j];
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return true;
        }
      }
    }
  }
  return false;
};

/**
 * Compile a caller-supplied grep pattern defensively: length-capped, a
 * heuristic reject for classic catastrophic-backtracking shapes, and only the
 * `i` flag is honored (line-by-line scanning already makes `m`/`s` moot; `g`/`y`
 * would introduce `lastIndex` statefulness we don't want).
 *
 * NOTE (residual risk, not fully closed): these heuristics catch the classic
 * shapes named above, but regex catastrophic backtracking has other forms
 * this crude structural check does not exhaustively cover, and a single
 * `regex.exec` call is not itself interruptible by the scan deadline once
 * started (see `LONG_LINE_GUARD_CHARS`). A fully robust fix would run pattern
 * matching in a worker thread with a hard timeout — out of scope for this
 * pass; flagged here as a follow-up rather than silently claimed solved.
 */
export const compileGrepPattern = (pattern: string, flags = ""): RegExp => {
  if (pattern.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "pattern must not be empty." });
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ORPCError("BAD_REQUEST", {
      message: `pattern exceeds the ${MAX_PATTERN_LENGTH}-char limit.`,
    });
  }
  if (CATASTROPHIC_PATTERN_HINT.test(pattern) || hasOverlappingQuantifiedAlternation(pattern)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "pattern rejected: nested/overlapping quantifiers can cause catastrophic backtracking.",
    });
  }
  const safeFlags = [...new Set([...flags].filter((flag) => flag === "i"))].join("");
  try {
    return new RegExp(pattern, safeFlags);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid pattern: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
};

// ── Line-by-line matching with context ──────────────────────────────────────

/**
 * Regex against a line is only ever run within this many chars — bounds one
 * exec's cost. Deliberately tight (not the object/response caps elsewhere in
 * the codebase): catastrophic-backtracking cost is exponential in input
 * length, so even at this size a crafted pattern that slips past
 * `CATASTROPHIC_PATTERN_HINT` / `hasOverlappingQuantifiedAlternation` can
 * still make a single `regex.exec` call run far longer than is comfortable —
 * a single `exec` is NOT interruptible by the scan deadline (that's only
 * re-checked between lines). This guard reduces, but does not eliminate, that
 * residual risk.
 */
export const LONG_LINE_GUARD_CHARS = 8 * 1024;
/** How often (in scanned lines) to re-check the wall-clock budget mid-source. */
export const DEADLINE_CHECK_EVERY_LINES = 500;

/** One source-neutral scan hit — real 1-based line/column, so a caller can address it precisely. */
export interface LineHit {
  /** 1-based line number within the scanned source. */
  line: number;
  /** 1-based character column (not byte offset) of the match start within the line. */
  column: number;
  /** The matching line, truncated if it exceeds the long-line guard. */
  text: string;
  before: string[];
  after: string[];
}

interface PendingHit {
  hit: LineHit;
  afterNeeded: number;
}

export interface ScanLinesOptions {
  regex: RegExp;
  contextLines: number;
  maxMatches: number;
  deadline: number;
}

export interface ScanLinesResult {
  hits: LineHit[];
  truncated: boolean;
}

/**
 * Scan an async line iterable for `regex` matches, with rolling before/after
 * context, a `maxMatches` budget, and a wall-clock `deadline` re-checked every
 * `DEADLINE_CHECK_EVERY_LINES` lines. Source-neutral: callers (files, Docs,
 * future records) wrap the returned `LineHit[]` with their own addressing.
 */
export const scanLines = async (
  lines: AsyncIterable<string>,
  opts: ScanLinesOptions,
): Promise<ScanLinesResult> => {
  const hits: LineHit[] = [];
  const pending: PendingHit[] = [];
  const rollingBefore: string[] = [];
  let lineNumber = 0;
  let linesSinceCheck = 0;
  let truncated = false;

  const flushReady = () => {
    while (pending.length > 0 && pending[0].afterNeeded === 0) {
      const next = pending.shift();
      if (next) hits.push(next.hit);
    }
  };

  for await (const rawLine of lines) {
    lineNumber++;
    linesSinceCheck++;
    if (linesSinceCheck >= DEADLINE_CHECK_EVERY_LINES) {
      linesSinceCheck = 0;
      if (Date.now() >= opts.deadline) {
        truncated = true;
        break;
      }
    }

    for (const item of pending) {
      if (item.afterNeeded > 0) {
        item.hit.after.push(rawLine);
        item.afterNeeded--;
      }
    }
    flushReady();
    if (hits.length >= opts.maxMatches) {
      truncated = true;
      break;
    }

    if (hits.length + pending.length < opts.maxMatches) {
      const withinGuard = rawLine.length > LONG_LINE_GUARD_CHARS;
      const guardedLine = withinGuard ? rawLine.slice(0, LONG_LINE_GUARD_CHARS) : rawLine;
      const execResult = opts.regex.exec(guardedLine);
      if (execResult) {
        const hit: LineHit = {
          line: lineNumber,
          column: execResult.index + 1,
          text: withinGuard ? `${guardedLine}…` : guardedLine,
          before: [...rollingBefore],
          after: [],
        };
        if (opts.contextLines > 0) {
          pending.push({ hit, afterNeeded: opts.contextLines });
        } else {
          hits.push(hit);
        }
      }
    }

    if (opts.contextLines > 0) {
      rollingBefore.push(rawLine);
      if (rollingBefore.length > opts.contextLines) rollingBefore.shift();
    }

    if (hits.length >= opts.maxMatches && pending.length === 0) {
      truncated = true;
      break;
    }
  }

  // EOF (or deadline break) — flush whatever pending hits have (partial `after` is fine).
  while (pending.length > 0 && hits.length < opts.maxMatches) {
    const next = pending.shift();
    if (next) hits.push(next.hit);
  }
  if (pending.length > 0) truncated = true;

  return { hits: hits.slice(0, opts.maxMatches), truncated };
};
