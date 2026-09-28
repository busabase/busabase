import "server-only";

/**
 * Unified Grep (files + node content + records + custom prompts) — the top-level composition
 * entry point for `POST /grep`.
 * Mirrors `logic/search.ts`'s shape: a top-level, cross-domain `logic/` file
 * (NOT owned by `domains/assets/`, `domains/doc/`, or `domains/base/`) that
 * resolves scope, dispatches to per-source adapters, and merges results
 * under one shared pattern + budget.
 *
 * - Files adapter: delegates to the existing `grepAssets` engine, preserving
 *   concurrency, optional `rg` acceleration, cache, self-heal, and coverage.
 - Nodes adapter: lists every non-archived node whose type stores a content
 *   object (registry-driven — see `logic/node-content.ts`; `doc`, `html`,
 *   `whiteboard`, `workflow`), reads each through the shared grep text cache
 *   with a files-style concurrency pool, and scans it through the same
 *   source-neutral `scanLines` core the files adapter's `scanLinesForMatches`
 *   wraps — "one pattern language everywhere" (spec's Interaction-First
 *   Principle #1). Text-native types stream; JSON types are extracted first.
 * - Records adapter (P2b): pages through canonical, active records
 *   (`busabase_records.status = "active"`, most-recently-updated first) and
 *   flattens each in-scope Base field's value from the record's HEAD commit
 *   (`busabase_commits.payload` jsonb) — never the truncated
 *   `busabase_field_values.valueText` search projection (see the spec's
 *   "records scan canonical commits, not the search projection" decision
 *   record). Deliberately does NOT reuse `loadBasesByIds`/`hydrateRecords`
 *   (`logic/seed.ts` / `logic/cr-lifecycle.ts`): those load EVERY base field
 *   row regardless of `deletedAt`, and `BaseFieldVO` doesn't even expose
 *   `deletedAt`, so a caller has no way to exclude a soft-deleted field's
 *   stale value that may still be sitting in `headCommit.payload`. This
 *   adapter's own batch loader filters `isNull(busabaseBaseFields.deletedAt)`
 *   explicitly, mirroring `domains/base/logic/queries.ts`'s `getBase`.
 * - Prompts adapter: scans the custom agent prompts stored on nodes
 *   (`busabase_nodes.agent_prompts`), label and body in every locale, after the
 *   same `customAgentPromptsSchema` validation the Ask Agent dialog applies.
 *
 * Budget: one deadline for the whole call, and each requested source gets a
 * floor of `maxMatches / sources` with unused budget rolling forward (see
 * `sourceBudget`), so a noisy source can no longer starve the others.
 */
import type {
  UnifiedGrepInput,
  UnifiedGrepMatchVO,
  UnifiedGrepResultVO,
} from "busabase-contract/contract/grep-schemas";
import { customAgentPromptsSchema } from "busabase-contract/contract/node-agent-prompt-schemas";
import type { FieldType } from "busabase-contract/types";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { type iString, iStringParse, type LocaleType } from "openlib/i18n/i-string";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import { busabaseCommits, busabaseNodes } from "../db/schema";
import { grepAssets, grepTimeoutMs } from "../domains/assets/logic/asset-grep-logic";
import { busabaseBaseFields, busabaseBases, busabaseRecords } from "../domains/base/schema";
import { hasCustomPromptsSql } from "../domains/playbooks/logic/playbooks";
import { buildNodeVisibilityCondition, buildNodeVisibilityExists } from "./node-acl";
import {
  isSearchableNodeType,
  linesFromText,
  openNodeContentLines,
  SEARCHABLE_NODE_TYPES,
  type SearchableNodeType,
} from "./node-content";
import { ensureReady } from "./seed";
import { compileGrepPattern, scanLines } from "./text-scan-core";

type Db = Awaited<ReturnType<typeof getDb>>;

const EMPTY_FILES_COVERAGE = {
  scanned: 0,
  missing: [] as string[],
  stale: [] as string[],
  unsearchable: 0,
  errored: [] as string[],
  notReached: 0,
};

const EMPTY_NODES_COVERAGE = {
  scanned: 0,
  errored: [] as string[],
  notReached: 0,
};

const EMPTY_RECORDS_COVERAGE = {
  scanned: 0,
  errored: [] as string[],
  notReached: 0,
};

const EMPTY_PROMPTS_COVERAGE = {
  scanned: 0,
  errored: [] as string[],
  notReached: 0,
};

// ── Node-content candidate resolution ───────────────────────────────────────

/**
 * Which node types this call should scan: the caller's `scope.nodes.types`
 * narrowed to types that actually have content, else every searchable type.
 * A caller wanting the pre-0.18 doc-only behaviour passes `types: ["doc"]`.
 */
const requestedNodeTypes = (
  scope: UnifiedGrepInput["scope"],
): [SearchableNodeType, ...SearchableNodeType[]] => {
  const requested = scope?.nodes?.types?.filter(isSearchableNodeType) ?? [];
  return requested.length > 0
    ? (requested as [SearchableNodeType, ...SearchableNodeType[]])
    : SEARCHABLE_NODE_TYPES;
};

/**
 * How many node bodies are read+scanned in parallel. Mirrors the files
 * adapter's `BUSABASE_GREP_CONCURRENCY` pool (and reads the same env var, so
 * one knob tunes both): each candidate costs a storage round trip, so a
 * sequential loop made total latency the SUM of every node's fetch instead of
 * roughly the slowest in each batch.
 *
 * The default must stay in lockstep with the files adapter's `grepConcurrency`
 * (16 — see the reasoning there: this batch is dominated by storage round trips,
 * not CPU). One knob, one number; a silent drift between the two would make the
 * env var mean different things for `sources: ["files"]` and `sources: ["nodes"]`.
 */
const nodeScanConcurrency = (): number => {
  const raw = process.env.BUSABASE_GREP_CONCURRENCY;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 16;
};

interface NodeCandidate {
  nodeId: string;
  slug: string;
  name: string;
  type: string;
}

/**
 * Lightweight candidate listing for the nodes adapter — id/slug/name/type
 * only, same non-archived + ACL WHERE clause `doc/handlers.ts`'s `listDocs()`
 * uses, but WITHOUT `listDocs()`'s eager `toDocVO()` body read for
 * every node. That eagerness would defeat budget-respecting scanning: the
 * nodes adapter must check the deadline/maxMatches budget BEFORE reading each
 * doc's body (mirroring `grepAssets`'s pre-dispatch budget check), not read
 * every body up front regardless of budget.
 */
const resolveCandidateNodes = async (
  db: Db,
  spaceId: string,
  scope: UnifiedGrepInput["scope"],
): Promise<NodeCandidate[]> => {
  const conditions = [
    eq(busabaseNodes.spaceId, spaceId),
    // Registry-driven, NOT a hardcoded "doc": every node type that stores a
    // content object is searchable. See `logic/node-content.ts`.
    inArray(busabaseNodes.type, requestedNodeTypes(scope)),
    isNull(busabaseNodes.archivedAt),
  ];
  // Node ACL in the candidate SQL (never post-filtered): the scanned/truncated
  // coverage stats are computed from this candidate set, so a post-filter
  // would both skew those numbers and reveal that hidden nodes exist.
  const visible = buildNodeVisibilityCondition(db);
  if (visible) {
    conditions.push(visible);
  }
  if (scope?.nodes?.nodeIds?.length) {
    conditions.push(inArray(busabaseNodes.id, scope.nodes.nodeIds));
  }
  return db
    .select({
      nodeId: busabaseNodes.id,
      slug: busabaseNodes.slug,
      name: busabaseNodes.name,
      type: busabaseNodes.type,
    })
    .from(busabaseNodes)
    .where(and(...conditions))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
};

// ── Records candidate resolution + batch loading ────────────────────────────

interface RecordCandidate {
  recordId: string;
  baseId: string;
  baseSlug: string;
  headCommitId: string;
}

/**
 * Lightweight candidate listing for the records adapter — id/baseId/baseSlug/
 * headCommitId only, joined to `busabase_bases` for the slug + archived-base
 * exclusion. Ordered `updatedAt` desc (a deliberate deviation from
 * `queries.ts`'s `listRecords`, which orders by `createdAt`): the spec wants
 * budget truncation to drop the STALEST content first, not the oldest-created.
 * Scope union semantics: a Base is in scope if its id is in `baseIds` OR its
 * slug is in `baseSlugs` — either match counts (not an intersection).
 */
const resolveCandidateRecords = async (
  db: Db,
  spaceId: string,
  scope: UnifiedGrepInput["scope"],
): Promise<RecordCandidate[]> => {
  const conditions = [
    eq(busabaseRecords.spaceId, spaceId),
    eq(busabaseRecords.status, "active"),
    isNull(busabaseBases.archivedAt),
    isNull(busabaseBases.deletedAt),
  ];
  // Node ACL in the candidate SQL — same reasoning as resolveCandidateNodes.
  const recordsVisible = buildNodeVisibilityExists(db, busabaseBases.nodeId);
  if (recordsVisible) {
    conditions.push(recordsVisible);
  }
  const baseIds = scope?.records?.baseIds;
  const baseSlugs = scope?.records?.baseSlugs;
  if (baseIds?.length || baseSlugs?.length) {
    // Union semantics: a Base is in scope if it matches EITHER list.
    const scopeUnion = or(
      baseIds?.length ? inArray(busabaseBases.id, baseIds) : undefined,
      baseSlugs?.length ? inArray(busabaseBases.slug, baseSlugs) : undefined,
    );
    if (scopeUnion) conditions.push(scopeUnion);
  }
  return db
    .select({
      recordId: busabaseRecords.id,
      baseId: busabaseRecords.baseId,
      baseSlug: busabaseBases.slug,
      headCommitId: busabaseRecords.headCommitId,
    })
    .from(busabaseRecords)
    .innerJoin(busabaseBases, eq(busabaseRecords.baseId, busabaseBases.id))
    .where(and(...conditions))
    .orderBy(desc(busabaseRecords.updatedAt));
};

interface RecordBatchData {
  /** headCommitId → the commit's raw `fields` jsonb (canonical, untruncated). */
  commitFieldsById: Map<string, Record<string, unknown>>;
  /** baseId → its non-deleted fields, in Base schema (position) order. */
  fieldsByBaseId: Map<string, Array<{ slug: string; type: FieldType }>>;
}

/**
 * Batch-load every in-scope candidate's HEAD commit fields and every
 * relevant Base's non-deleted fields — two queries total for the whole grep
 * call, not N+1 per record. This is the adapter's own minimal loader (see
 * the module doc for why `loadBasesByIds`/`hydrateRecords` are NOT used
 * here): the field query explicitly filters `isNull(busabaseBaseFields.deletedAt)`,
 * so a field soft-deleted after a record was written never resurfaces a
 * stale value still sitting under its old slug in `headCommit.payload`.
 */
const loadRecordBatchData = async (
  db: Db,
  candidates: RecordCandidate[],
): Promise<RecordBatchData> => {
  const commitFieldsById = new Map<string, Record<string, unknown>>();
  const fieldsByBaseId = new Map<string, Array<{ slug: string; type: FieldType }>>();
  if (candidates.length === 0) {
    return { commitFieldsById, fieldsByBaseId };
  }

  const headCommitIds = [...new Set(candidates.map((c) => c.headCommitId))];
  const baseIds = [...new Set(candidates.map((c) => c.baseId))];

  const commitRows = await db
    .select({ id: busabaseCommits.id, fields: busabaseCommits.payload })
    .from(busabaseCommits)
    .where(inArray(busabaseCommits.id, headCommitIds));
  for (const row of commitRows) {
    commitFieldsById.set(row.id, row.fields);
  }

  const fieldRows = await db
    .select({
      baseId: busabaseBaseFields.baseId,
      slug: busabaseBaseFields.slug,
      type: busabaseBaseFields.type,
    })
    .from(busabaseBaseFields)
    .where(and(inArray(busabaseBaseFields.baseId, baseIds), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.baseId), asc(busabaseBaseFields.position));
  for (const row of fieldRows) {
    const list = fieldsByBaseId.get(row.baseId) ?? [];
    list.push({ slug: row.slug, type: row.type as FieldType });
    fieldsByBaseId.set(row.baseId, list);
  }

  return { commitFieldsById, fieldsByBaseId };
};

/**
 * Field flattening rules for records grep (the spec's "field flattening
 * rules" — authoritative here, informed by but NOT identical to
 * `logic/vo.ts`'s `normalizeFieldValue`, which backs the truncated search
 * projection this feature exists to bypass). Returns `undefined` when the
 * field has no scannable content — caller must skip it (don't scan, don't
 * count as errored).
 *
 * 1. `undefined`/`null` → no content, skip.
 * 2. `attachment`/`relation` → skip (pointers/refs, not content — the
 *    referenced file's own content is the files source's job). `whiteboard`
 *    → skip too: its value is a structured { scene, previewSvg } composite,
 *    not prose, and dumping the raw scene JSON / SVG markup into the grep
 *    index would be noise, not a meaningful match.
 * 3. `json` → `JSON.stringify(value)`, one line (structured data, not prose).
 * 4. `string` → used AS-IS, preserving real newlines (this is what lets a
 *    multi-line longtext/markdown field's real line numbers show up).
 * 5. `number`/`boolean` → `String(value)`, one line.
 * 6. `Array` → `value.join(", ")`, one line (any array-valued field, not
 *    just multiselect).
 * 7. Anything else (unexpected object shape) → `JSON.stringify(value)`, one
 *    line — same safe fallback as rule 3.
 */
const flattenFieldValue = (fieldType: FieldType, value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (fieldType === "attachment" || fieldType === "relation" || fieldType === "whiteboard") {
    return undefined;
  }
  if (fieldType === "json") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
};

// ── Per-source adapters ──────────────────────────────────────────────────────

/** What one source adapter hands back to the composer. */
interface SourceRun<TCoverage> {
  matches: UnifiedGrepMatchVO[];
  coverage: TCoverage;
  truncated: boolean;
}

/** Shared per-call settings every adapter scans with. */
interface ScanBudget {
  regex: RegExp;
  contextLines: number;
  /** This source's share of `maxMatches` (may be 0 when earlier sources used everything). */
  maxMatches: number;
  /** One wall-clock deadline for the WHOLE grep call — never restarted per source. */
  deadline: number;
}

const runFiles = async (
  input: UnifiedGrepInput,
  budget: ScanBudget,
): Promise<SourceRun<typeof EMPTY_FILES_COVERAGE>> => {
  const filesResult = await grepAssets(
    {
      pattern: input.pattern,
      flags: input.flags,
      scope: input.scope?.files,
      maxMatches: budget.maxMatches,
      contextLines: input.contextLines,
    },
    { deadline: budget.deadline },
  );
  return {
    matches: filesResult.matches.map(
      (match): UnifiedGrepMatchVO => ({ source: "files", ...match }),
    ),
    coverage: {
      scanned: filesResult.filesScanned,
      missing: filesResult.missing,
      stale: filesResult.stale,
      unsearchable: filesResult.unsearchable,
      errored: filesResult.errored,
      notReached: filesResult.notReached,
    },
    truncated: filesResult.truncated,
  };
};

const runNodes = async (
  db: Db,
  spaceId: string,
  input: UnifiedGrepInput,
  budget: ScanBudget,
): Promise<SourceRun<typeof EMPTY_NODES_COVERAGE>> => {
  const candidates = await resolveCandidateNodes(db, spaceId, input.scope);
  const matches: UnifiedGrepMatchVO[] = [];
  let truncated = false;
  let scanned = 0;
  const errored: string[] = [];
  let notReached = 0;
  const concurrency = Math.max(1, nodeScanConcurrency());

  for (let i = 0; i < candidates.length; ) {
    // Budget check BEFORE dispatching the next batch — the same gate the files
    // adapter applies per batch. An already-dispatched batch always runs to
    // completion; this only stops a NEW one from starting.
    if (Date.now() >= budget.deadline || matches.length >= budget.maxMatches) {
      notReached = candidates.length - i;
      truncated = true;
      break;
    }

    const batch = candidates.slice(i, i + concurrency);
    // Every node in the batch gets the SAME remaining-match budget, computed
    // once per batch.
    const batchMaxMatches = budget.maxMatches - matches.length;

    const settled = await Promise.allSettled(
      batch.map(async (candidate) => {
        const type = candidate.type as SearchableNodeType;
        const lines = await openNodeContentLines(type, candidate.nodeId);
        return scanLines(lines, {
          regex: budget.regex,
          contextLines: budget.contextLines,
          maxMatches: batchMaxMatches,
          deadline: budget.deadline,
        });
      }),
    );

    // Fold outcomes in the batch's ORIGINAL candidate order (not completion
    // order), so `matches` stays deterministic regardless of which node's
    // storage read happened to finish first.
    for (let j = 0; j < batch.length; j++) {
      const outcome = settled[j];
      const candidate = batch[j];
      if (outcome.status === "fulfilled") {
        scanned++;
        matches.push(
          ...outcome.value.hits.map(
            (hit): UnifiedGrepMatchVO => ({
              source: "nodes",
              type: candidate.type as SearchableNodeType,
              nodeId: candidate.nodeId,
              slug: candidate.slug,
              name: candidate.name,
              ...hit,
            }),
          ),
        );
        if (outcome.value.truncated) truncated = true;
      } else {
        // Content read/scan failure for this node — it was NOT actually
        // searched. Never counted as a clean "scanned, no match".
        errored.push(candidate.nodeId);
      }
    }

    // A dispatched batch runs every node to completion even if an earlier one
    // already hit the budget, so `matches` can overshoot by a bounded amount.
    // Cap it here so this source never exceeds its share.
    if (matches.length > budget.maxMatches) {
      matches.length = budget.maxMatches;
      truncated = true;
    }

    i += batch.length;
  }
  return { matches, coverage: { scanned, errored, notReached }, truncated };
};

const runRecords = async (
  db: Db,
  spaceId: string,
  input: UnifiedGrepInput,
  budget: ScanBudget,
): Promise<SourceRun<typeof EMPTY_RECORDS_COVERAGE>> => {
  const candidates = await resolveCandidateRecords(db, spaceId, input.scope);
  const { commitFieldsById, fieldsByBaseId } = await loadRecordBatchData(db, candidates);
  const matches: UnifiedGrepMatchVO[] = [];
  let truncated = false;
  let scanned = 0;
  const errored: string[] = [];
  let notReached = 0;

  for (let i = 0; i < candidates.length; i++) {
    // Budget check BEFORE dispatching the next record: `notReached` counts
    // records never even started.
    if (Date.now() >= budget.deadline || matches.length >= budget.maxMatches) {
      notReached = candidates.length - i;
      truncated = true;
      break;
    }
    const candidate = candidates[i];
    try {
      const commitFields = commitFieldsById.get(candidate.headCommitId) ?? {};
      const fields = fieldsByBaseId.get(candidate.baseId) ?? [];
      // Fields are visited in Base schema (position) order. Each field is
      // scanned as its OWN independent line-source — never concatenated
      // with another field's text — so `before`/`after` context can never
      // cross a field or record boundary.
      for (const field of fields) {
        // Budget may have been exhausted by an earlier field in THIS same
        // record — stop scanning this record's remaining fields, but the
        // record still counts as "scanned" below (it was genuinely
        // dispatched), not "notReached".
        if (matches.length >= budget.maxMatches) break;
        const flattened = flattenFieldValue(field.type, commitFields[field.slug]);
        if (flattened === undefined) continue;
        const { hits, truncated: fieldTruncated } = await scanLines(linesFromText(flattened), {
          regex: budget.regex,
          contextLines: budget.contextLines,
          maxMatches: budget.maxMatches - matches.length,
          deadline: budget.deadline,
        });
        matches.push(
          ...hits.map(
            (hit): UnifiedGrepMatchVO => ({
              source: "records",
              baseId: candidate.baseId,
              baseSlug: candidate.baseSlug,
              recordId: candidate.recordId,
              fieldSlug: field.slug,
              ...hit,
            }),
          ),
        );
        if (fieldTruncated) truncated = true;
      }
      // Placed AFTER the field loop (not before): a record that hit the
      // budget mid-way (a `break` above, not a throw) still reaches this
      // line and counts as scanned. A record whose flattening/scanning
      // genuinely throws never reaches this line — it falls through to
      // the catch below and is excluded from `scanned`.
      scanned++;
    } catch {
      // Read/flatten/scan failure for this record — it was NOT actually
      // searched, e.g. a malformed `headCommit.payload` value that throws
      // during flattening.
      errored.push(candidate.recordId);
    }
  }
  return { matches, coverage: { scanned, errored, notReached }, truncated };
};

// ── Custom prompts ───────────────────────────────────────────────────────────

/**
 * Every localized value of an iString, in stored key order: a plain string is
 * the single `"default"` value, a locale map yields one entry per locale.
 */
const localizedValues = (value: iString): Array<{ locale: string; text: string }> =>
  typeof value === "string"
    ? [{ locale: "default", text: value }]
    : Object.entries(value).flatMap(([locale, text]) =>
        typeof text === "string" ? [{ locale, text }] : [],
      );

/**
 * Candidate listing for the prompts adapter: every non-archived, non-deleted
 * node the caller can read whose `agent_prompts` is a non-empty list — the
 * same node set `playbooks.search` draws its prompts from (shared
 * `hasCustomPromptsSql`). ACL in the SQL for the same reason as the nodes
 * adapter: coverage counts are computed from this set.
 */
const resolveCandidatePromptNodes = async (db: Db, spaceId: string) =>
  db
    .select({
      nodeId: busabaseNodes.id,
      name: busabaseNodes.name,
      slug: busabaseNodes.slug,
      type: busabaseNodes.type,
      agentPrompts: busabaseNodes.agentPrompts,
    })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
        buildNodeVisibilityCondition(db),
        hasCustomPromptsSql,
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));

/**
 * Scan custom agent prompts: per node, per prompt (stored order), `label`
 * then `body`, each locale as its OWN line-source so context never crosses
 * from one locale's text into another's. A stored list that fails
 * `customAgentPromptsSchema` (a manual jsonb edit, a pre-validation write) is
 * reported in `errored` — it was not searched — rather than scanned raw:
 * grep must see the same prompts the Ask Agent dialog and playbooks do.
 */
const runPrompts = async (
  db: Db,
  spaceId: string,
  budget: ScanBudget,
): Promise<SourceRun<typeof EMPTY_PROMPTS_COVERAGE>> => {
  const candidates = await resolveCandidatePromptNodes(db, spaceId);
  const matches: UnifiedGrepMatchVO[] = [];
  let truncated = false;
  let scanned = 0;
  const errored: string[] = [];
  let notReached = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() >= budget.deadline || matches.length >= budget.maxMatches) {
      notReached = candidates.length - i;
      truncated = true;
      break;
    }
    const candidate = candidates[i];
    const validated = customAgentPromptsSchema.safeParse(candidate.agentPrompts);
    if (!validated.success) {
      errored.push(candidate.nodeId);
      continue;
    }
    scanning: for (const prompt of validated.data) {
      for (const field of ["label", "body"] as const) {
        for (const { locale, text } of localizedValues(prompt[field])) {
          // Budget spent mid-node: stop, but the node still counts as scanned.
          if (matches.length >= budget.maxMatches) break scanning;
          const { hits, truncated: valueTruncated } = await scanLines(linesFromText(text), {
            regex: budget.regex,
            contextLines: budget.contextLines,
            maxMatches: budget.maxMatches - matches.length,
            deadline: budget.deadline,
          });
          matches.push(
            ...hits.map(
              (hit): UnifiedGrepMatchVO => ({
                source: "prompts",
                nodeId: candidate.nodeId,
                nodeName: candidate.name,
                nodeType: candidate.type,
                nodeSlug: candidate.slug,
                key: prompt.key,
                label: iStringParse(
                  prompt.label,
                  (locale === "default" ? "en" : locale) as LocaleType,
                ),
                locale,
                field,
                ...hit,
              }),
            ),
          );
          if (valueTruncated) truncated = true;
        }
      }
    }
    scanned++;
  }
  return { matches, coverage: { scanned, errored, notReached }, truncated };
};

// ── grep ─────────────────────────────────────────────────────────────────────

/** Fixed output (and scan) order. Budget rolls forward along it, never backwards. */
const SOURCE_ORDER = ["files", "nodes", "records", "prompts"] as const;

/**
 * This source's share of `maxMatches`: at least its floor (while any budget is
 * left), plus whatever earlier sources left unused — but never eating into the
 * floors still reserved for the sources after it.
 *
 * `floor = max(1, floor(maxMatches / sourceCount))`. With maxMatches 20 and four
 * sources, files may use 5; if it uses all 5, nodes may use 5; if nodes found
 * nothing, records may use 10; prompts gets what is left. The last source takes
 * every remaining slot, so the remainder of the division is not lost.
 */
const sourceBudget = (opts: {
  maxMatches: number;
  used: number;
  floor: number;
  sourcesAfter: number;
}): number => {
  const remaining = Math.max(0, opts.maxMatches - opts.used);
  return Math.max(Math.min(opts.floor, remaining), remaining - opts.floor * opts.sourcesAfter);
};

export const grepUnified = async (input: UnifiedGrepInput): Promise<UnifiedGrepResultVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Compiled once — every adapter scans through the identical compiled regex
  // ("one pattern language everywhere", spec's Interaction-First Principle #1).
  const regex = compileGrepPattern(input.pattern, input.flags);
  const requested = new Set(input.sources ?? SOURCE_ORDER);
  const sources = SOURCE_ORDER.filter((source) => requested.has(source));

  // ONE wall-clock deadline for the whole call (the `grepAssets` budget
  // constant/env var), passed into every adapter — including files, which
  // takes it as an option instead of starting its own clock.
  const deadline = Date.now() + grepTimeoutMs();
  // Fair budget: no single source can use the whole `maxMatches` before the
  // others start (200 file hits used to leave records with nothing).
  const floor = Math.max(1, Math.floor(input.maxMatches / Math.max(1, sources.length)));

  const matches: UnifiedGrepMatchVO[] = [];
  let filesCoverage = EMPTY_FILES_COVERAGE;
  let nodesCoverage = EMPTY_NODES_COVERAGE;
  let recordsCoverage = EMPTY_RECORDS_COVERAGE;
  let promptsCoverage = EMPTY_PROMPTS_COVERAGE;
  let truncated = false;

  for (const [index, source] of sources.entries()) {
    const budget: ScanBudget = {
      regex,
      contextLines: input.contextLines,
      deadline,
      maxMatches: sourceBudget({
        maxMatches: input.maxMatches,
        used: matches.length,
        floor,
        sourcesAfter: sources.length - index - 1,
      }),
    };
    if (source === "files") {
      const run = await runFiles(input, budget);
      matches.push(...run.matches);
      filesCoverage = run.coverage;
      truncated ||= run.truncated;
    } else if (source === "nodes") {
      const run = await runNodes(db, spaceId, input, budget);
      matches.push(...run.matches);
      nodesCoverage = run.coverage;
      truncated ||= run.truncated;
    } else if (source === "records") {
      const run = await runRecords(db, spaceId, input, budget);
      matches.push(...run.matches);
      recordsCoverage = run.coverage;
      truncated ||= run.truncated;
    } else {
      const run = await runPrompts(db, spaceId, budget);
      matches.push(...run.matches);
      promptsCoverage = run.coverage;
      truncated ||= run.truncated;
    }
  }

  // Each source is capped at its own share, and the shares sum to at most
  // `maxMatches`; the slice is a belt-and-braces guard, not the budget.
  if (matches.length > input.maxMatches) truncated = true;

  return {
    matches: matches.slice(0, input.maxMatches),
    coverage: {
      files: filesCoverage,
      nodes: nodesCoverage,
      records: recordsCoverage,
      prompts: promptsCoverage,
    },
    truncated,
  };
};
