import "server-only";

/**
 * Unified Grep (P2a files+docs, P2b records) — the top-level composition
 * entry point for `POST /grep`. See apps/busabase/content/spec/unified-grep.md.
 * Mirrors `logic/search.ts`'s shape: a top-level, cross-domain `logic/` file
 * (NOT owned by `domains/assets/`, `domains/doc/`, or `domains/base/`) that
 * resolves scope, dispatches to per-source adapters, and merges results
 * under one shared pattern + budget.
 *
 * - Files adapter: delegates to the EXISTING, unmodified `grepAssets` — zero
 *   behavior change to `assets.grep` (concurrency pool, optional `rg`
 *   acceleration, cache, self-heal — all reused as-is).
 * - Docs adapter: lists non-archived Doc nodes, reads each body, and scans
 *   it through the same source-neutral `scanLines` core the files adapter's
 *   `scanLinesForMatches` wraps — "one pattern language everywhere" (spec's
 *   Interaction-First Principle #1).
 * - Records adapter (P2b): pages through canonical, active records
 *   (`busabase_records.status = "active"`, most-recently-updated first) and
 *   flattens each in-scope Base field's value from the record's HEAD commit
 *   (`busabase_commits.fields` jsonb) — never the truncated
 *   `busabase_field_values.valueText` search projection (see the spec's
 *   "records scan canonical commits, not the search projection" decision
 *   record). Deliberately does NOT reuse `loadBasesByIds`/`hydrateRecords`
 *   (`logic/seed.ts` / `logic/cr-lifecycle.ts`): those load EVERY base field
 *   row regardless of `deletedAt`, and `BaseFieldVO` doesn't even expose
 *   `deletedAt`, so a caller has no way to exclude a soft-deleted field's
 *   stale value that may still be sitting in `headCommit.fields`. This
 *   adapter's own batch loader filters `isNull(busabaseBaseFields.deletedAt)`
 *   explicitly, mirroring `domains/base/logic/queries.ts`'s `getBase`.
 */
import type {
  UnifiedGrepInput,
  UnifiedGrepMatchVO,
  UnifiedGrepResultVO,
} from "busabase-contract/contract/grep-schemas";
import type { FieldType } from "busabase-contract/types";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import { busabaseCommits, busabaseNodes } from "../db/schema";
import { grepAssets, grepTimeoutMs } from "../domains/assets/logic/asset-grep-logic";
import { busabaseBaseFields, busabaseBases, busabaseRecords } from "../domains/base/schema";
import { docBodyKey } from "../domains/doc/handlers";
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

const EMPTY_DOCS_COVERAGE = {
  scanned: 0,
  errored: [] as string[],
  notReached: 0,
};

const EMPTY_RECORDS_COVERAGE = {
  scanned: 0,
  errored: [] as string[],
  notReached: 0,
};

// ── Docs candidate resolution ────────────────────────────────────────────────

interface DocCandidate {
  nodeId: string;
  slug: string;
  name: string;
}

/**
 * Lightweight candidate listing for the docs adapter — id/slug/name only,
 * same WHERE clause `doc/handlers.ts`'s `listDocs()` uses (non-archived,
 * `type: "doc"`), but WITHOUT `listDocs()`'s eager `toDocVO()` body read for
 * every node. That eagerness would defeat budget-respecting scanning: the
 * docs adapter must check the deadline/maxMatches budget BEFORE reading each
 * doc's body (mirroring `grepAssets`'s pre-dispatch budget check), not read
 * every body up front regardless of budget.
 */
const resolveCandidateDocs = async (
  db: Db,
  spaceId: string,
  scope: UnifiedGrepInput["scope"],
): Promise<DocCandidate[]> => {
  const conditions = [
    eq(busabaseNodes.spaceId, spaceId),
    eq(busabaseNodes.type, "doc"),
    isNull(busabaseNodes.archivedAt),
  ];
  if (scope?.docs?.nodeIds?.length) {
    conditions.push(inArray(busabaseNodes.id, scope.docs.nodeIds));
  }
  return db
    .select({ nodeId: busabaseNodes.id, slug: busabaseNodes.slug, name: busabaseNodes.name })
    .from(busabaseNodes)
    .where(and(...conditions))
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
};

/**
 * Read a Doc body for grep purposes — same storage key and full-buffer-read
 * shape as `doc/handlers.ts`'s `readDocBody` (Doc bodies are storage-native,
 * KB-scale markdown objects; see the spec's "Doc bodies stay storage-native"
 * decision record — a chunked/streaming reader is deliberately NOT built
 * here), but WITHOUT that function's `.catch(() => Buffer.from(""))` swallow.
 * That swallow is the right default for `doc/handlers.ts`'s own callers (a
 * Doc can legitimately have no body object yet); grep's honest-coverage
 * contract needs the opposite — a genuine storage failure must surface as
 * `coverage.docs.errored`, never silently read back as a clean empty scan.
 */
const readDocBodyForGrep = async (nodeId: string): Promise<string> =>
  (await storage.getObject(docBodyKey(nodeId))).toString("utf8");

/**
 * Split a text blob into lines with the same convention the files adapter's
 * `iterateLinesFromFile` (Node's `readline`) uses: a trailing `\n` does not
 * create a phantom empty final line, `\r\n` is normalized to `\n`, and an
 * empty body is zero lines (not one empty line) — so a Doc's reported line
 * numbers match what `docs.get` + a text editor would show. Shared by BOTH
 * the docs adapter (a Doc body) and the records adapter (one field's
 * flattened value) — one splitter, not two slightly-different ones.
 */
const splitDocLines = (body: string): string[] => {
  if (body.length === 0) return [];
  const raw = body.split("\n");
  if (body.endsWith("\n")) raw.pop(); // trailing "\n" does not add a phantom empty last line
  return raw.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
};

async function* linesFromBody(body: string): AsyncGenerator<string> {
  for (const line of splitDocLines(body)) {
    yield line;
  }
}

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
 * stale value still sitting under its old slug in `headCommit.fields`.
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
    .select({ id: busabaseCommits.id, fields: busabaseCommits.fields })
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
 *    referenced file's own content is the files source's job).
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
  if (fieldType === "attachment" || fieldType === "relation") return undefined;
  if (fieldType === "json") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
};

// ── grep ─────────────────────────────────────────────────────────────────────

export const grepUnified = async (input: UnifiedGrepInput): Promise<UnifiedGrepResultVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Compiled once — both adapters scan through the identical compiled regex
  // ("one pattern language everywhere", spec's Interaction-First Principle #1).
  const regex = compileGrepPattern(input.pattern, input.flags);
  const sources = input.sources ?? ["files", "docs", "records"];

  // One shared wall-clock deadline for the docs + records phases, from the
  // SAME budget constant/env var `grepAssets` uses (`grepTimeoutMs`) — not a
  // second timeout knob. `grepAssets` itself computes its own deadline
  // internally (its signature takes no deadline param, and it is
  // intentionally left unmodified — see module doc), so true single-epoch
  // sharing across all three phases isn't structurally possible without
  // changing that signature; reusing the identical `grepTimeoutMs()`
  // duration for all three is the faithful within-scope approximation (the
  // anchors differ only by the few ms between the calls).
  const deadline = Date.now() + grepTimeoutMs();
  const matches: UnifiedGrepMatchVO[] = [];
  let filesCoverage = EMPTY_FILES_COVERAGE;
  let docsCoverage = EMPTY_DOCS_COVERAGE;
  let recordsCoverage = EMPTY_RECORDS_COVERAGE;
  let truncated = false;

  // Files first (deterministic order: files, then docs — matches the spec's
  // API surface). Files gets its FULL requested maxMatches budget, not a
  // pre-split share — it runs to completion before docs even starts.
  if (sources.includes("files")) {
    const filesResult = await grepAssets({
      pattern: input.pattern,
      flags: input.flags,
      scope: input.scope?.files,
      maxMatches: input.maxMatches,
      contextLines: input.contextLines,
    });
    matches.push(
      ...filesResult.matches.map((match): UnifiedGrepMatchVO => ({ source: "files", ...match })),
    );
    filesCoverage = {
      scanned: filesResult.filesScanned,
      missing: filesResult.missing,
      stale: filesResult.stale,
      unsearchable: filesResult.unsearchable,
      errored: filesResult.errored,
      notReached: filesResult.notReached,
    };
    if (filesResult.truncated) truncated = true;
  }

  // Docs second — whatever budget files already consumed (`matches.length`)
  // is what's left; this is the "files' matches count against the SAME
  // budget docs then sees" sharing the spec calls for.
  if (sources.includes("docs")) {
    const candidates = await resolveCandidateDocs(db, spaceId, input.scope);
    let scanned = 0;
    const errored: string[] = [];
    let notReached = 0;

    for (let i = 0; i < candidates.length; i++) {
      // Budget check BEFORE dispatching the next doc — mirrors `grepAssets`'s
      // pre-dispatch check exactly: `notReached` counts docs never even
      // started, not docs that were scanned but had no match.
      if (Date.now() >= deadline || matches.length >= input.maxMatches) {
        notReached = candidates.length - i;
        truncated = true;
        break;
      }
      const candidate = candidates[i];
      try {
        const body = await readDocBodyForGrep(candidate.nodeId);
        const { hits, truncated: docTruncated } = await scanLines(linesFromBody(body), {
          regex,
          contextLines: input.contextLines,
          maxMatches: input.maxMatches - matches.length,
          deadline,
        });
        scanned++;
        matches.push(
          ...hits.map(
            (hit): UnifiedGrepMatchVO => ({
              source: "docs",
              nodeId: candidate.nodeId,
              slug: candidate.slug,
              name: candidate.name,
              ...hit,
            }),
          ),
        );
        if (docTruncated) truncated = true;
      } catch {
        // Body read/scan failure for this doc — it was NOT actually
        // searched. Same honesty `grepAssets` applies per-candidate: this
        // must never be counted as a clean "scanned, no match".
        errored.push(candidate.nodeId);
      }
    }
    docsCoverage = { scanned, errored, notReached };
  }

  // Records third — whatever budget files+docs already consumed is what's
  // left, same sharing rule as docs' comment above.
  if (sources.includes("records")) {
    const candidates = await resolveCandidateRecords(db, spaceId, input.scope);
    const { commitFieldsById, fieldsByBaseId } = await loadRecordBatchData(db, candidates);
    let scanned = 0;
    const errored: string[] = [];
    let notReached = 0;

    for (let i = 0; i < candidates.length; i++) {
      // Budget check BEFORE dispatching the next record — mirrors
      // `grepAssets`'s/docs' pre-dispatch check exactly: `notReached` counts
      // records never even started.
      if (Date.now() >= deadline || matches.length >= input.maxMatches) {
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
          if (matches.length >= input.maxMatches) break;
          const flattened = flattenFieldValue(field.type, commitFields[field.slug]);
          if (flattened === undefined) continue;
          const { hits, truncated: fieldTruncated } = await scanLines(linesFromBody(flattened), {
            regex,
            contextLines: input.contextLines,
            maxMatches: input.maxMatches - matches.length,
            deadline,
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
        // the catch below and is excluded from `scanned`, same mutual
        // exclusivity the docs adapter's `errored` has with its `scanned`.
        scanned++;
      } catch {
        // Read/flatten/scan failure for this record — it was NOT actually
        // searched. Should not normally happen (all data is already in
        // memory from the batch load above), but guard anyway, e.g. a
        // malformed `headCommit.fields` value that throws during
        // flattening. Same honesty `grepAssets`/docs apply per-candidate.
        errored.push(candidate.recordId);
      }
    }
    recordsCoverage = { scanned, errored, notReached };
  }

  if (matches.length >= input.maxMatches) truncated = true;

  return {
    matches: matches.slice(0, input.maxMatches),
    coverage: { files: filesCoverage, docs: docsCoverage, records: recordsCoverage },
    truncated,
  };
};
