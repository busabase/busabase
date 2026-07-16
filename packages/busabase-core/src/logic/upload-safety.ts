import "server-only";

import { ORPCError } from "@orpc/server";
import ignore from "ignore";

/**
 * Upload safety for AirApp/Skill/Drive file-tree writes (`createFileTreeNode`
 * and `createFileTreeChangeRequest` in `../domains/filetree/handlers.ts`,
 * shared by the airapp/skill/drive domains — none special-cased). Three
 * independent layers, always applied in this order:
 *
 * 1. `filterByGitignore` — silent filter, git-like semantics. An uploaded
 *    `.gitignore` is used to silently drop OTHER matching entries from the
 *    same batch (no error — the same "junk never even shows up" behavior as
 *    `git add .`). The `.gitignore` entry itself is never matched against its
 *    own rules, so it survives filtering like it would in a real `git add .`.
 * 2. `assertNoForbiddenPaths` — hard reject, unconditional. A small built-in
 *    default-deny list (`.env`, `node_modules/**`, `.ssh/**`, ...) checked
 *    against whatever survives step 1, regardless of whether the caller
 *    supplied a `.gitignore` at all. This is the safety net for callers with
 *    no `.gitignore` or an incomplete one.
 * 3. `scanForSecrets` — hard reject, unconditional. Regex scan over the
 *    inline `content` of whatever survives steps 1-2. Deliberately scoped to
 *    inline text content only — entries that reference an asset by `assetId`
 *    (binary uploads) are not scanned in this phase; fetching + scanning
 *    every binary asset's bytes on every write is real added latency/cost
 *    for a much smaller realistic leak surface than text/config files.
 *    Documented follow-up, not an oversight (see the changelog).
 *
 * Both hard-reject checks throw a structured `ORPCError` (never a plain
 * `Error`) so the oRPC OpenAPIHandler maps them to the right HTTP status
 * instead of falling back to 500 — same pattern as `assertContainerParent` in
 * `./node-parent.ts`.
 */

/** Minimal shape every checked entry must have: a path, and (for step 3)
 * optionally inline text content. Entries with no `content` (e.g. an
 * `assetId`-referenced file, or a `kind: "delete"` operation) still carry a
 * `path` and so still go through steps 1-2. */
export interface UploadSafetyEntry {
  path: string;
  content?: string;
}

export const GITIGNORE_PATH = ".gitignore";

/**
 * The `ignore` package validates its input strictly: it throws a raw
 * `RangeError` (not something we control the shape of) for a pathname it
 * considers malformed for matching — notably anything containing a `..`
 * traversal segment (e.g. `../escape.md`) or an absolute path. Those paths
 * are already rejected with a clean `ORPCError("BAD_REQUEST")` a little
 * further downstream by `normalizeFilePath`
 * (`../domains/filetree/logic/storage.ts`, called once per operation before
 * it's written) — this layer's job is deny-list/secret matching on
 * well-formed paths, not path-traversal validation. So: treat "the matcher
 * itself refused to evaluate this path" as "no match here", and let that
 * existing downstream check produce the real, existing error instead of an
 * uncaught `RangeError` blowing past every ORPCError-aware error boundary.
 */
const safeIgnores = (matcher: ReturnType<typeof ignore>, path: string): boolean => {
  try {
    return matcher.ignores(path);
  } catch {
    return false;
  }
};

export interface GitignoreFilterResult<T extends UploadSafetyEntry> {
  /** The entries that survive filtering, in original order (including the
   * `.gitignore` entry itself, if present — it is never dropped by its own
   * rules). */
  kept: T[];
  /** Paths of entries silently dropped because they matched the uploaded
   * `.gitignore`'s rules. Never includes the `.gitignore` path itself. */
  skipped: string[];
}

/**
 * Step 1. If `entries` contains a `path === ".gitignore"` entry with inline
 * `content`, parse it and silently drop every OTHER entry whose path matches
 * those rules. No-ops (returns everything, nothing skipped) when no
 * `.gitignore` entry is present.
 */
export const filterByGitignore = <T extends UploadSafetyEntry>(
  entries: readonly T[],
): GitignoreFilterResult<T> => {
  const gitignoreEntry = entries.find(
    (entry) => entry.path === GITIGNORE_PATH && typeof entry.content === "string",
  );
  if (!gitignoreEntry) {
    return { kept: [...entries], skipped: [] };
  }

  const matcher = ignore().add(gitignoreEntry.content ?? "");
  const kept: T[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry === gitignoreEntry) {
      // Never matched against its own rules — mirrors `git add .`, which
      // tracks the .gitignore file itself.
      kept.push(entry);
      continue;
    }
    if (safeIgnores(matcher, entry.path)) {
      skipped.push(entry.path);
      continue;
    }
    kept.push(entry);
  }
  return { kept, skipped };
};

/**
 * True when every *real* candidate entry (anything other than the
 * `.gitignore` entry itself) was silently dropped by `filterByGitignore` —
 * i.e. the caller uploaded a `.gitignore` plus real files, and the
 * `.gitignore` excluded all of them. Distinguishes that confusing case from
 * a batch that simply never had any non-`.gitignore` candidates to begin
 * with (nothing to reject there — e.g. a lone `.gitignore` upload, or the
 * ordinary empty-`files`-array create call, both remain valid).
 */
export const allFilteredByGitignore = <T extends UploadSafetyEntry>(
  original: readonly T[],
  result: GitignoreFilterResult<T>,
): boolean => {
  const hadCandidates = original.some((entry) => entry.path !== GITIGNORE_PATH);
  const hasSurvivors = result.kept.some((entry) => entry.path !== GITIGNORE_PATH);
  return hadCandidates && !hasSurvivors;
};

// ── Step 2: built-in default-deny list ──────────────────────────────────────

const DEFAULT_DENY_PATTERNS = [
  ".env",
  ".env.*",
  "node_modules/**",
  ".git/**",
  ".aws/credentials",
  ".aws/config",
  ".ssh/**",
  "*.pem",
  "*.pfx",
];

const DENY_MATCHERS = DEFAULT_DENY_PATTERNS.map((pattern) => ({
  pattern,
  matcher: ignore().add(pattern),
}));

export interface BlockedPath {
  path: string;
  pattern: string;
}

/**
 * Step 2. Rejects the whole batch — a structured `ORPCError("FORBIDDEN_PATH",
 * { status: 422 })` listing every offending path — if any path matches the
 * built-in default-deny list. Independent of step 1: runs regardless of
 * whether the caller supplied a `.gitignore`, and against a wholly separate
 * pattern set (checked one pattern at a time so each hit can report exactly
 * which built-in rule it tripped).
 */
export const assertNoForbiddenPaths = (paths: readonly string[]): void => {
  const blockedPaths: BlockedPath[] = [];
  for (const path of paths) {
    const hit = DENY_MATCHERS.find(({ matcher }) => safeIgnores(matcher, path));
    if (hit) {
      blockedPaths.push({ path, pattern: hit.pattern });
    }
  }
  if (blockedPaths.length > 0) {
    throw new ORPCError("FORBIDDEN_PATH", {
      status: 422,
      message: `Upload rejected: ${blockedPaths.length} path(s) match the built-in default-deny list (secrets, credentials, VCS/dependency directories).`,
      data: { blockedPaths },
    });
  }
};

// ── Step 3: secret content scan ─────────────────────────────────────────────

interface SecretRule {
  name: string;
  pattern: RegExp;
}

// ~8 rules, deliberately small and high-signal rather than exhaustive. Names
// only (never the matched substring) are ever surfaced in an error — see
// `scanForSecrets` below.
const SECRET_RULES: SecretRule[] = [
  { name: "aws-access-key", pattern: /(AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}/ },
  { name: "gcp-api-key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: "stripe-key", pattern: /sk_(live|test)_[0-9a-zA-Z]{16,}/ },
  {
    name: "generic-api-key-assignment",
    pattern: /(api[_-]?key|secret|token)['"]?\s*[:=]\s*['"][0-9A-Za-z_-]{16,}['"]/i,
  },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: "pem-private-key", pattern: /-----BEGIN\s?(RSA|EC|OPENSSH|DSA|PGP)?\s?PRIVATE KEY-----/ },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
];

export interface SecretFinding {
  path: string;
  ruleName: string;
}

/**
 * Step 3. Scans the inline `content` of every entry that has any (entries
 * with no `content` — asset-referenced or `delete` — are skipped, not
 * scanned). Aggregates every match across the whole batch — never
 * fail-fasts on the first hit — into one
 * `ORPCError("SECRET_DETECTED", { status: 422 })`.
 *
 * Critical security property: `data.findings` carries only `{ path,
 * ruleName }`. The matched substring is never captured, stored, or included
 * anywhere in the thrown error — only a boolean `.test()` is ever run
 * against the content, so there is nothing to leak.
 */
export const scanForSecrets = (entries: readonly UploadSafetyEntry[]): void => {
  const findings: SecretFinding[] = [];
  for (const entry of entries) {
    if (typeof entry.content !== "string" || entry.content.length === 0) continue;
    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(entry.content)) {
        findings.push({ path: entry.path, ruleName: rule.name });
      }
    }
  }
  if (findings.length > 0) {
    throw new ORPCError("SECRET_DETECTED", {
      status: 422,
      message: `Upload rejected: ${findings.length} likely secret(s) detected in file content. Remove them and retry — matched values are never echoed back.`,
      data: { findings },
    });
  }
};
