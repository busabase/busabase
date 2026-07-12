/**
 * Unified Grep (P2a files+docs, P2b records) — top-level, domain-agnostic
 * schemas for `POST /grep`. See apps/busabase/content/spec/unified-grep.md.
 *
 * Mirrors how `search`'s schemas live top-level in `contract/schemas.ts`
 * rather than inside a single domain's contract: `grep` composes multiple
 * domains (files, Docs, Base records), so its schemas belong at the same
 * level as `search`'s, not inside `domains/assets/` or `domains/base/`.
 * `assets.grep` (files-only specialist) keeps its own separate schemas in
 * `domains/assets/types.ts`, unchanged — this file intentionally reuses only
 * its numeric default/cap constants (same budget language), never its type
 * names (which would collide: `GrepMatchVO` vs `UnifiedGrepMatchVO`, etc.).
 *
 * Pure zod — no logic/db imports (client-safe: pulled into the browser
 * bundle and the RN oRPC client's type graph).
 */
import { z } from "zod";
import {
  GREP_DEFAULT_CONTEXT_LINES,
  GREP_DEFAULT_MAX_MATCHES,
  GREP_HARD_MAX_MATCHES,
  GREP_MAX_CONTEXT_LINES,
} from "../domains/assets/types";

/**
 * Sources Unified Grep can scan. `"records"` (P2b) scans canonical Base
 * record commits (`headCommit.fields`) — never the truncated
 * `busabase_field_values` search projection, per the spec's decision record
 * on why that projection can't back grep.
 */
export const GrepSourceSchema = z.enum(["files", "docs", "records"]);
export type GrepSource = z.infer<typeof GrepSourceSchema>;

/** Files scope — identical shape to `assets.grep`'s `GrepScopeSchema` (same semantics, kept separate to avoid a cross-contract type dependency). */
export const UnifiedGrepFilesScopeSchema = z.object({
  assetIds: z.array(z.string()).optional(),
  /** Drive/Skill mounted path prefix (matches `busabase_asset_usages.path`). */
  drivePath: z.string().optional(),
  mimeTypes: z.array(z.string()).optional(),
});
export type UnifiedGrepFilesScope = z.infer<typeof UnifiedGrepFilesScopeSchema>;

/** Docs scope — narrow to specific Doc node ids; omitted scans every non-archived Doc in the Space. */
export const UnifiedGrepDocsScopeSchema = z.object({
  nodeIds: z.array(z.string()).optional(),
});
export type UnifiedGrepDocsScope = z.infer<typeof UnifiedGrepDocsScopeSchema>;

/**
 * Records scope — narrow to specific Bases by id and/or slug (union
 * semantics: a Base is in scope if it matches EITHER list — giving both is
 * not an intersection). Omitted scans every non-archived Base's active
 * records in the current space.
 */
export const UnifiedGrepRecordsScopeSchema = z.object({
  baseIds: z.array(z.string()).optional(),
  baseSlugs: z.array(z.string()).optional(),
});
export type UnifiedGrepRecordsScope = z.infer<typeof UnifiedGrepRecordsScopeSchema>;

export const UnifiedGrepScopeSchema = z.object({
  files: UnifiedGrepFilesScopeSchema.optional(),
  docs: UnifiedGrepDocsScopeSchema.optional(),
  records: UnifiedGrepRecordsScopeSchema.optional(),
});
export type UnifiedGrepScope = z.infer<typeof UnifiedGrepScopeSchema>;

export const UnifiedGrepInputSchema = z.object({
  pattern: z.string().min(1),
  /** JS RegExp flags, e.g. `"i"` for case-insensitive — same language as `assets.grep`. */
  flags: z.string().optional().default(""),
  /** Which sources to scan. Omitted = all three (`files`, `docs`, `records`). */
  sources: z.array(GrepSourceSchema).optional(),
  scope: UnifiedGrepScopeSchema.optional(),
  /** Shared across every scanned source — files run to completion first, then docs, then whatever remains goes to records. */
  maxMatches: z.coerce
    .number()
    .int()
    .min(1)
    .max(GREP_HARD_MAX_MATCHES)
    .optional()
    .default(GREP_DEFAULT_MAX_MATCHES),
  contextLines: z.coerce
    .number()
    .int()
    .min(0)
    .max(GREP_MAX_CONTEXT_LINES)
    .optional()
    .default(GREP_DEFAULT_CONTEXT_LINES),
});
export type UnifiedGrepInput = z.infer<typeof UnifiedGrepInputSchema>;

/** Fields every source's match carries — real 1-based line/column, so a caller can read exactly around it. */
const grepHitFields = {
  line: z.number().int().positive(),
  /** 1-based character column (not byte offset) of the match start within the line. */
  column: z.number().int().positive(),
  /** The matching line, truncated if it exceeds the long-line guard. */
  text: z.string(),
  before: z.array(z.string()),
  after: z.array(z.string()),
};

export const UnifiedGrepFileMatchVOSchema = z.object({
  source: z.literal("files"),
  assetId: z.string(),
  fileName: z.string(),
  /** Drive/Skill mounted path, or "" when the asset isn't path-mounted (e.g. a File node). */
  drivePath: z.string(),
  ...grepHitFields,
});
export type UnifiedGrepFileMatchVO = z.infer<typeof UnifiedGrepFileMatchVOSchema>;

export const UnifiedGrepDocMatchVOSchema = z.object({
  source: z.literal("docs"),
  nodeId: z.string(),
  slug: z.string(),
  name: z.string(),
  ...grepHitFields,
});
export type UnifiedGrepDocMatchVO = z.infer<typeof UnifiedGrepDocMatchVOSchema>;

export const UnifiedGrepRecordMatchVOSchema = z.object({
  source: z.literal("records"),
  baseId: z.string(),
  baseSlug: z.string(),
  recordId: z.string(),
  fieldSlug: z.string(),
  ...grepHitFields,
});
export type UnifiedGrepRecordMatchVO = z.infer<typeof UnifiedGrepRecordMatchVOSchema>;

export const UnifiedGrepMatchVOSchema = z.discriminatedUnion("source", [
  UnifiedGrepFileMatchVOSchema,
  UnifiedGrepDocMatchVOSchema,
  UnifiedGrepRecordMatchVOSchema,
]);
export type UnifiedGrepMatchVO = z.infer<typeof UnifiedGrepMatchVOSchema>;

/** Files coverage — identical semantics to `assets.grep`'s `GrepResultVOSchema` coverage fields. */
export const UnifiedGrepFilesCoverageSchema = z.object({
  scanned: z.number().int().nonnegative(),
  missing: z.array(z.string()),
  stale: z.array(z.string()),
  unsearchable: z.number().int().nonnegative(),
  errored: z.array(z.string()),
  notReached: z.number().int().nonnegative(),
});
export type UnifiedGrepFilesCoverage = z.infer<typeof UnifiedGrepFilesCoverageSchema>;

/** Docs coverage — simpler than files' (no missing/stale/unsearchable concept for a storage-native Doc body). */
export const UnifiedGrepDocsCoverageSchema = z.object({
  scanned: z.number().int().nonnegative(),
  /** Doc node ids whose body read/scan was attempted but failed — NOT a clean "scanned, no match". */
  errored: z.array(z.string()),
  /** Count of in-scope docs the scan never reached because the deadline/maxMatches budget ran out first. */
  notReached: z.number().int().nonnegative(),
});
export type UnifiedGrepDocsCoverage = z.infer<typeof UnifiedGrepDocsCoverageSchema>;

/** Records coverage — same simple shape as docs' (no missing/stale/unsearchable concept for canonical commit data). */
export const UnifiedGrepRecordsCoverageSchema = z.object({
  scanned: z.number().int().nonnegative(),
  /** Record ids whose commit-fields read/flatten/scan was attempted but failed — NOT a clean "scanned, no match". */
  errored: z.array(z.string()),
  /** Count of in-scope records the scan never reached because the deadline/maxMatches budget ran out first. */
  notReached: z.number().int().nonnegative(),
});
export type UnifiedGrepRecordsCoverage = z.infer<typeof UnifiedGrepRecordsCoverageSchema>;

export const UnifiedGrepCoverageSchema = z.object({
  files: UnifiedGrepFilesCoverageSchema,
  docs: UnifiedGrepDocsCoverageSchema,
  records: UnifiedGrepRecordsCoverageSchema,
});
export type UnifiedGrepCoverage = z.infer<typeof UnifiedGrepCoverageSchema>;

export const UnifiedGrepResultVOSchema = z.object({
  /** Deterministic order: every `files` match, then every `docs` match, then every `records` match. */
  matches: z.array(UnifiedGrepMatchVOSchema),
  coverage: UnifiedGrepCoverageSchema,
  /** True when any source truncated, or any source has `notReached > 0`. */
  truncated: z.boolean(),
});
export type UnifiedGrepResultVO = z.infer<typeof UnifiedGrepResultVOSchema>;
