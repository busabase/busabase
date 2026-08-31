import "server-only";

import type {
  ChangeRequestVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
} from "busabase-contract/types";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, notExists, or, sql } from "drizzle-orm";
import { iStringConcat, iStringParse, iStringSchema } from "openlib/i18n/i-string";
import { z } from "zod";
import { getContextSpaceId } from "../context";
import { type DbInstance, getDb } from "../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseFieldValues,
  busabaseNodeContentSearch,
  busabaseNodes,
  busabaseRecords,
} from "../db/schema";
import {
  autoRegisterAssetText,
  loadAssetTextRows,
} from "../domains/assets/logic/asset-texts-logic";
import { openAssetTextSource } from "../domains/assets/logic/text-cache";
import { getPrimaryField } from "../domains/base/utils/primary-field";
import { hydrateChangeRequest, hydrateRecord } from "./cr-lifecycle";
import {
  buildBaseVisibilityExists,
  buildNodeVisibilityCondition,
  buildNodeVisibilityExists,
} from "./node-acl";
import { isSearchableNodeType, reindexNodeContent, SEARCHABLE_NODE_TYPES } from "./node-content";
import { ensureReady } from "./seed";
import { toBaseVO } from "./vo";

// Mirrors `contract/schemas.ts`s SEARCH_SOURCES; `nodes` searches node CONTENT
// and is named to match grep's `nodes` source.
export const SEARCH_SOURCES = ["records", "files", "names", "nodes"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

// Schema defined locally to avoid circular deps with store.ts
export const searchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
  /**
   * Restrict which content this call searches — "records" (the field-value
   * ranking query + their originating ChangeRequests), "files" (Drive/Skill
   * asset content), "names" (Base/field name matches). Omitted/undefined
   * means all three, matching every caller before this parameter existed.
   * `search()` has no way to skip the expensive records-ranking query
   * otherwise — it always ran regardless of what content type a caller
   * actually cared about.
   *
   * A GET query param that occurs exactly once (`?sources=records`) arrives
   * as a bare string, not a 1-element array — only a REPEATED occurrence
   * (`?sources=records&sources=files`) becomes an array. Accept both shapes
   * and normalize to an array.
   */
  sources: z
    .union([z.array(z.enum(SEARCH_SOURCES)), z.enum(SEARCH_SOURCES)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
});

export const recordPrimaryText = (record: RecordVO): string => {
  const primarySlug = getPrimaryField(record.base)?.slug;
  return (primarySlug ? String(record.headCommit.payload[primarySlug] ?? "") : "") || record.id;
};

const toSearchText = (fields: Record<string, unknown>) =>
  Object.entries(fields)
    .map(
      ([fieldSlug, value]) =>
        `${fieldSlug} ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" ");

// Commit `fields.name` may be an iString record (field CRs) — resolve it to a
// display string instead of String()-ing an object into "[object Object]".
const searchTitleText = (value: unknown): string => {
  const parsed = iStringSchema.safeParse(value);
  return parsed.success ? iStringParse(parsed.data) : String(value);
};

const toRecordSearchResult = (record: RecordVO): SearchResultVO => ({
  id: record.id,
  kind: "record",
  title: recordPrimaryText(record),
  body: String(record.headCommit.payload.body ?? record.headCommit.payload.description ?? ""),
  eyebrow: `${record.base.name} · canonical record`,
  href: `/base/${record.base.slug}/${record.id}`,
  updatedAt: record.updatedAt,
});

const toChangeRequestSearchResult = (changeRequest: ChangeRequestVO): SearchResultVO => ({
  id: changeRequest.id,
  kind: "change_request",
  title:
    changeRequest.operationCount > 1
      ? `${changeRequest.operationCount} operation changeRequest`
      : searchTitleText(
          changeRequest.primaryOperation?.headCommit.payload.title ??
            changeRequest.primaryOperation?.headCommit.payload.name ??
            changeRequest.id,
        ),
  body: changeRequest.operations
    .map((operation) => toSearchText(operation.headCommit.payload))
    .join(" "),
  eyebrow: `${changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree"} · ${changeRequest.status}`,
  href: `/inbox/${changeRequest.id}`,
  updatedAt: changeRequest.updatedAt,
});

const toBaseSearchResult = (base: ReturnType<typeof toBaseVO>): SearchResultVO => ({
  id: base.id,
  kind: "base",
  title: base.name,
  // Index every locale of each field name so search hits any translation.
  body: `${base.description} ${base.fields.map((field) => `${iStringConcat(field.name)} ${field.slug}`).join(" ")}`,
  eyebrow: `${base.fields.length} fields · ${base.slug}`,
  href: `/base/${base.slug}`,
  updatedAt: base.createdAt,
});

const fileResultHref = (nodeType: string, nodeSlug: string) => {
  if (nodeType === "drive") return `/drive/${nodeSlug}`;
  if (nodeType === "skill") return `/skill/${nodeSlug}`;
  if (nodeType === "file") return `/file/${nodeSlug}`;
  if (nodeType === "doc") return `/doc/${nodeSlug}`;
  if (nodeType === "base") return `/base/${nodeSlug}`;
  return `/${nodeType}/${nodeSlug}`;
};

/**
 * Node CONTENT search — the human counterpart to grep's `nodes` source.
 *
 * Reads the `busabase_node_content_search` projection, which holds exactly the
 * text grep scans (same `NODE_CONTENT_ADAPTERS` extraction), truncated to
 * `VALUE_TEXT_INDEX_LIMIT`. See `content/spec/node-content-search.md`.
 */
const NODE_SNIPPET_RADIUS = 60;
/**
 * How many unindexed nodes one search request will index before querying.
 *
 * Bounded on purpose: a workspace upgraded from before this feature has no
 * projection rows, and indexing them all in the first search would make that
 * one request arbitrarily slow — worst on the largest workspaces, which are
 * exactly the ones that need search most. A small batch per request lets the
 * index fill in across a few searches instead (spec D3: gradually, never a
 * stalled request).
 */
const NODE_SELF_HEAL_BATCH = 25;

/** A snippet centred on the match, so the user can tell near-identical docs apart (spec S1). */
const buildNodeSnippet = (content: string, query: string): string => {
  const at = content.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0)
    return content
      .slice(0, NODE_SNIPPET_RADIUS * 2)
      .replace(/\s+/g, " ")
      .trim();
  const start = Math.max(0, at - NODE_SNIPPET_RADIUS);
  const end = Math.min(content.length, at + query.length + NODE_SNIPPET_RADIUS);
  const core = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < content.length ? "…" : ""}`;
};

const NODE_KIND_LABEL: Record<string, string> = {
  doc: "Doc",
  html: "Page",
  whiteboard: "Whiteboard",
  workflow: "Workflow",
};

/**
 * Index up to `NODE_SELF_HEAL_BATCH` content-bearing nodes that have no
 * projection row yet — the lazy backfill for workspaces that predate this
 * feature (spec D3). Fail-soft per node: a missing content object leaves that
 * node unindexed and retried next time rather than failing the search.
 */
const selfHealNodeProjections = async (db: DbInstance, spaceId: string): Promise<void> => {
  const stale = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        inArray(busabaseNodes.type, SEARCHABLE_NODE_TYPES),
        notExists(
          db
            .select({ one: sql`1` })
            .from(busabaseNodeContentSearch)
            .where(eq(busabaseNodeContentSearch.nodeId, busabaseNodes.id)),
        ),
      ),
    )
    .limit(NODE_SELF_HEAL_BATCH);
  for (const node of stale) {
    if (!isSearchableNodeType(node.type)) continue;
    await reindexNodeContent(db, { nodeId: node.id, spaceId, nodeType: node.type });
  }
};

/**
 * Search node content. Node ACL is applied INSIDE this query, never after —
 * post-filtering would both over-count `hasMore` and let a caller infer that
 * hidden nodes exist (spec D4).
 */
const searchNodeContent = async (
  db: DbInstance,
  spaceId: string,
  query: string,
  limit: number,
): Promise<{ results: SearchResultVO[]; truncated: boolean }> => {
  await selfHealNodeProjections(db, spaceId);
  const pattern = `%${query}%`;
  const rows = await db
    .select({
      nodeId: busabaseNodeContentSearch.nodeId,
      nodeType: busabaseNodeContentSearch.nodeType,
      contentText: busabaseNodeContentSearch.contentText,
      truncated: busabaseNodeContentSearch.truncated,
      name: busabaseNodes.name,
      slug: busabaseNodes.slug,
      updatedAt: busabaseNodes.updatedAt,
    })
    .from(busabaseNodeContentSearch)
    .innerJoin(busabaseNodes, eq(busabaseNodeContentSearch.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodeContentSearch.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
        or(
          // Whole-lexeme match. Contributes nothing for CJK — Postgres has no
          // segmenter there, so a Chinese run becomes one oversized lexeme that
          // is dropped from the index entirely (spec D2a). Kept because it IS
          // the good branch for English/mixed content.
          sql`to_tsvector('simple', coalesce(${busabaseNodeContentSearch.contentText}, '')) @@ plainto_tsquery('simple', ${query})`,
          // Substring match, trigram-indexed. This is the branch that carries
          // CJK search entirely — never drop its index to save space.
          ilike(busabaseNodeContentSearch.contentText, pattern),
        ),
      ),
    )
    .orderBy(desc(busabaseNodes.updatedAt))
    .limit(limit);

  // Whether the ANSWER may be incomplete — deliberately NOT derived from the
  // matched rows. The case this exists for is precisely the one with zero
  // matches: a phrase living past the cap of some in-scope document produces no
  // hits at all, so asking the hits whether anything was truncated always says
  // "no" exactly when the user most needs to be told otherwise.
  const [truncatedInScope] = await db
    .select({ nodeId: busabaseNodeContentSearch.nodeId })
    .from(busabaseNodeContentSearch)
    .innerJoin(busabaseNodes, eq(busabaseNodeContentSearch.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodeContentSearch.spaceId, spaceId),
        eq(busabaseNodeContentSearch.truncated, true),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .limit(1);

  return {
    results: rows.map((row) => ({
      id: row.nodeId,
      kind: "node" as const,
      title: row.name,
      body: buildNodeSnippet(row.contentText ?? "", query),
      eyebrow: NODE_KIND_LABEL[row.nodeType] ?? row.nodeType,
      href: fileResultHref(row.nodeType, row.slug),
      updatedAt: row.updatedAt?.toISOString() ?? null,
    })),
    truncated: truncatedInScope !== undefined,
  };
};

const fileMatchesQuery = (query: string, ...values: (string | null | undefined)[]) => {
  const lowerQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(lowerQuery));
};

/**
 * Wall-clock budget for the WHOLE body-scan phase of one `search()` call (not
 * per file) — mirrors `grepTimeoutMs()` in `asset-grep-logic.ts`: read once
 * per call, parsed as a number, sensible default on missing/invalid.
 * Overridable via `BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS` so tests can exercise
 * the timeout path deterministically. Without this, a query that matches no
 * metadata across many large `present`-status text files could scan
 * gigabytes with no time bound now that the old 256KB-per-file cap is gone.
 */
const searchFileScanTimeoutMs = (): number => {
  const raw = process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
};

// Upper bound on how many asset-usage rows the CONTENT-scan fallback below
// reads before giving up — it pays for a real object-storage read per
// candidate, so it needs a cost bound the way `searchNodeContent` doesn't.
// Ordered by recency so the cap favors the files someone is most likely
// searching for. Deliberately NOT applied to identity matching (see spec S2):
// that used to be the same cap serving both jobs, which meant an exact
// filename match could be pushed out of the window by unrelated churn
// elsewhere in the space (record attachments, CR attachments…) and search
// would report a clean empty result — indistinguishable from "does not
// exist". A cost bound on a live body-scan is defensible; the same bound
// silently hiding an exact name match is not.
const MAX_ASSET_USAGE_SCAN_ROWS = 1000;

/** Shared select shape both phases below query — kept in one place so they can never drift. */
const assetUsageRowSelection = () => ({
  assetId: busabaseAssets.id,
  assetName: busabaseAssets.name,
  contentKind: busabaseAssets.contentKind,
  fileName: attachments.fileName,
  usageMetadata: busabaseAssetUsages.metadata,
  usagePath: busabaseAssetUsages.path,
  ownerType: busabaseAssetUsages.ownerType,
  recordId: busabaseAssetUsages.recordId,
  fieldSlug: busabaseAssetUsages.fieldSlug,
  blockId: busabaseAssetUsages.blockId,
  updatedAt: busabaseAssetUsages.updatedAt,
  nodeId: busabaseNodes.id,
  nodeName: busabaseNodes.name,
  nodeDescription: busabaseNodes.description,
  nodeSlug: busabaseNodes.slug,
  nodeType: busabaseNodes.type,
});

type AssetUsageRow = Awaited<ReturnType<typeof queryAssetUsageRows>>[number];

const queryAssetUsageRows = (
  db: DbInstance,
  spaceId: string,
  extraCondition: ReturnType<typeof and> | undefined,
  limitRows: number,
) =>
  db
    .select(assetUsageRowSelection())
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .innerJoin(busabaseNodes, eq(busabaseAssetUsages.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseAssetUsages.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
        extraCondition,
      ),
    )
    .orderBy(desc(busabaseAssetUsages.updatedAt))
    .limit(limitRows);

/**
 * The IDENTITY a user searches a file by — never internal metadata (ids,
 * hashes, MIME types, owner/field/block references) — pushed into SQL so a
 * match is found regardless of how the row ranks by recency (spec S2).
 * `displayName` lives inside a jsonb column, hence the `->>'` extraction
 * rather than a typed column reference.
 */
const fileIdentitySqlCondition = (pattern: string) =>
  or(
    ilike(busabaseAssets.name, pattern),
    sql`${busabaseAssetUsages.metadata}->>'displayName' ILIKE ${pattern}`,
    ilike(attachments.fileName, pattern),
    ilike(busabaseAssetUsages.path, pattern),
    ilike(busabaseNodes.name, pattern),
    ilike(busabaseNodes.description, pattern),
    ilike(busabaseNodes.slug, pattern),
  );

const rowResultKey = (row: AssetUsageRow): string =>
  `${row.assetId}:${row.nodeId}:${row.usagePath}:${row.recordId}:${row.fieldSlug}:${row.blockId}`;

const toFileSearchResult = (row: AssetUsageRow, body: string): SearchResultVO => {
  const displayName =
    typeof row.usageMetadata.displayName === "string" ? row.usageMetadata.displayName : null;
  return {
    id: rowResultKey(row),
    kind: "file",
    title: displayName
      ? displayName
      : row.usagePath
        ? row.usagePath.split("/").at(-1) || row.assetName
        : row.assetName,
    body: body.slice(0, 280),
    eyebrow: `${row.nodeName} · ${row.ownerType}`,
    href: fileResultHref(row.nodeType, row.nodeSlug),
    updatedAt: row.updatedAt.toISOString(),
  };
};

/**
 * Files matched by a live CONTENT scan — the expensive fallback for a phrase
 * that isn't in any candidate's identity. Bounded by `MAX_ASSET_USAGE_SCAN_ROWS`
 * candidates and a wall-clock budget, and skips anything `identityMatchedKeys`
 * already produced a result for (phase 1 already covers those).
 */
const scanFileContents = async (
  db: DbInstance,
  spaceId: string,
  query: string,
  limit: number,
  identityMatchedKeys: Set<string>,
): Promise<{ results: SearchResultVO[]; scannedAllEligible: boolean }> => {
  const rows = await queryAssetUsageRows(db, spaceId, undefined, MAX_ASSET_USAGE_SCAN_ROWS);

  // Cheap existence check, independent of `rows` above: answers "did the cap
  // leave anything out", which the matched rows can never answer on their own
  // — the case this exists for is exactly zero content matches, where asking
  // the (empty) hit set whether anything was capped always says "no" exactly
  // when the caller most needs to be told otherwise (mirrors `searchNodeContent`'s
  // `truncatedInScope`, spec D2b).
  const [beyondCap] = await db
    .select({ id: busabaseAssetUsages.id })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseNodes, eq(busabaseAssetUsages.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseAssetUsages.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .orderBy(desc(busabaseAssetUsages.updatedAt))
    .offset(MAX_ASSET_USAGE_SCAN_ROWS)
    .limit(1);
  const overCap = beyondCap !== undefined;

  // Same "one source of truth for what text an asset has" infrastructure the
  // grep engine uses (`asset-grep-logic.ts`'s `grepAssets`), instead of a
  // separate raw-bytes read. Batch-load existing text rows, then lazily
  // self-heal any text-kind asset that predates this feature and has no row
  // yet — mirrors grep's exact self-heal pattern so legacy assets stay
  // content-searchable without a backfill job.
  const assetIds = [...new Set(rows.map((row) => row.assetId))];
  let textRows = await loadAssetTextRows(db, assetIds);
  const toSelfHeal = [
    ...new Set(
      rows
        .filter((row) => row.contentKind === "text" && !textRows.has(row.assetId))
        .map((row) => row.assetId),
    ),
  ];
  if (toSelfHeal.length > 0) {
    await Promise.all(
      toSelfHeal.map((assetId) =>
        autoRegisterAssetText(assetId, db, { knownContentKind: "text", knownMissing: true }),
      ),
    );
    textRows = await loadAssetTextRows(db, assetIds);
  }

  // Wall-clock budget for the WHOLE body-scan phase below (not per file) —
  // computed once, before the loop starts.
  const deadline = Date.now() + searchFileScanTimeoutMs();
  const results: SearchResultVO[] = [];

  for (const row of rows) {
    if (identityMatchedKeys.has(rowResultKey(row))) {
      // Phase 1 (SQL, uncapped) already matched and returned this exact row —
      // scanning its body too would just re-find the same result a second time.
      continue;
    }
    // Only reachable for candidates identity didn't already match, and only
    // for an asset with a `present` text row (a `missing` / `none` / `stale`
    // row, or no row at all, means: not eligible — skip, no error).
    const textRow = textRows.get(row.assetId);
    if (!textRow || textRow.status !== "present") {
      continue;
    }
    // Budget check BEFORE starting this candidate's body scan — once the
    // deadline trips, every REMAINING candidate is skipped the same way.
    if (Date.now() >= deadline) {
      continue;
    }
    let matchedLine: string | undefined;
    try {
      const source = await openAssetTextSource(textRow);
      for await (const line of source.iterateLines()) {
        if (fileMatchesQuery(query, line)) {
          matchedLine = line;
          break;
        }
      }
    } catch {
      // Best-effort, mirrors the old `.catch(() => "")` swallow: a read
      // failure (deleted mid-flight, corrupt cache, etc.) is treated as no
      // match on this file rather than failing the whole search.
    }
    if (matchedLine === undefined) {
      continue;
    }
    // The matched LINE, not the whole file — the snippet reflects the real
    // match location instead of arbitrary head bytes.
    results.push(toFileSearchResult(row, matchedLine));
    if (results.length >= limit) {
      break;
    }
  }
  return { results, scannedAllEligible: !overCap };
};

const searchAssetBackedFiles = async (
  query: string,
  limit: number,
): Promise<{ results: SearchResultVO[]; truncated: boolean }> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const pattern = `%${query}%`;

  // Phase 1: identity match, pushed into SQL, NOT subject to
  // `MAX_ASSET_USAGE_SCAN_ROWS` — an indexed string comparison over the whole
  // space costs nothing like a body scan, so there is no reason to let an
  // exact filename match go missing just because other, newer, unrelated
  // usages outrank it by recency (spec S2).
  const identityRows = await queryAssetUsageRows(
    db,
    spaceId,
    fileIdentitySqlCondition(pattern),
    limit,
  );
  const identityResults = identityRows.map((row) =>
    toFileSearchResult(
      row,
      [row.nodeDescription, row.usagePath, row.fileName].filter(Boolean).join(" "),
    ),
  );

  if (identityResults.length >= limit) {
    // Already have everything this call can return — no need to pay for a
    // content scan, and nothing was left uninspected as a RESULT of this
    // search (a caller wanting content coverage on a later page would still
    // hit the scan below).
    return { results: identityResults, truncated: false };
  }

  const identityMatchedKeys = new Set(identityRows.map(rowResultKey));
  const { results: contentResults, scannedAllEligible } = await scanFileContents(
    db,
    spaceId,
    query,
    limit - identityResults.length,
    identityMatchedKeys,
  );

  return {
    results: [...identityResults, ...contentResults],
    // Only worth flagging when identity found NOTHING: that's the case spec S2
    // actually cares about — a query whose only path to a match was the capped
    // content scan, so an incomplete scan could plausibly be hiding a real file
    // behind an empty-looking result. Once identity already confirmed the file
    // exists, that specific "doesn't exist" false reading is off the table —
    // an uncapped content scan finding additional, separate matches is a real
    // but lesser concern than what this flag was built to solve.
    truncated: identityResults.length === 0 && !scannedAllEligible,
  };
};

export const searchBusabase = async (
  input?: z.input<typeof searchInputSchema>,
): Promise<SearchResponseVO> => {
  await ensureReady();
  const db = await getDb();
  const parsed = searchInputSchema.parse(input);
  const query = parsed.query.trim();
  if (!query) {
    return {
      contentTruncated: false,
      hasMore: false,
      limit: parsed.limit,
      offset: parsed.offset,
      query,
      results: [],
    };
  }

  const pageSize = parsed.limit + 1;
  const pattern = `%${query}%`;
  const spaceId = getContextSpaceId();
  const textSearch = sql`to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')) @@ plainto_tsquery('simple', ${query})`;

  // No `sources` means every caller before this parameter existed — search
  // everything, unchanged behavior.
  const wantsSource = (source: SearchSource) => !parsed.sources || parsed.sources.includes(source);
  const wantsRecords = wantsSource("records");
  const wantsFiles = wantsSource("files");
  const wantsNames = wantsSource("names");
  const wantsNodes = wantsSource("nodes");

  const projectionRows = wantsRecords
    ? await db
        .select({
          changeRequestId: busabaseFieldValues.changeRequestId,
          recordId: busabaseFieldValues.recordId,
        })
        .from(busabaseFieldValues)
        .where(
          and(
            eq(busabaseFieldValues.spaceId, spaceId),
            isNotNull(busabaseFieldValues.valueText),
            isNull(busabaseFieldValues.deletedAt),
            // Node ACL, applied IN the candidate SQL (not post-filtered) so
            // pagination/hasMore never over-counts hidden rows — a mismatch
            // there would both break paging and leak that private rows exist.
            buildBaseVisibilityExists(db, busabaseFieldValues.baseId),
            or(
              textSearch,
              ilike(busabaseFieldValues.valueText, pattern),
              ilike(busabaseFieldValues.fieldSlug, pattern),
            ),
          ),
        )
        .groupBy(busabaseFieldValues.recordId, busabaseFieldValues.changeRequestId)
        .orderBy(
          desc(
            sql`max(ts_rank(to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')), plainto_tsquery('simple', ${query})))`,
          ),
          desc(sql`max(${busabaseFieldValues.updatedAt})`),
        )
        .limit(pageSize)
        .offset(parsed.offset)
    : [];

  const recordIds = projectionRows
    .map((row) => row.recordId)
    .filter((recordId): recordId is string => Boolean(recordId));
  const changeRequestIds = projectionRows
    .map((row) => row.changeRequestId)
    .filter((changeRequestId): changeRequestId is string => Boolean(changeRequestId));

  const [recordRows, changeRequestRows, baseRows, fieldRows] = await Promise.all([
    recordIds.length > 0
      ? db
          .select()
          .from(busabaseRecords)
          .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.status, "active")))
      : Promise.resolve([]),
    changeRequestIds.length > 0
      ? db
          .select()
          .from(busabaseChangeRequests)
          .where(inArray(busabaseChangeRequests.id, changeRequestIds))
      : Promise.resolve([]),
    wantsNames && parsed.offset === 0
      ? db
          .select()
          .from(busabaseBases)
          .where(
            and(
              eq(busabaseBases.spaceId, spaceId),
              isNull(busabaseBases.archivedAt),
              buildNodeVisibilityExists(db, busabaseBases.nodeId),
              or(
                ilike(busabaseBases.name, pattern),
                ilike(busabaseBases.description, pattern),
                ilike(busabaseBases.slug, pattern),
              ),
            ),
          )
      : Promise.resolve([]),
    wantsNames && parsed.offset === 0
      ? db
          .select()
          .from(busabaseBaseFields)
          .where(
            and(
              eq(busabaseBaseFields.spaceId, spaceId),
              buildBaseVisibilityExists(db, busabaseBaseFields.baseId),
              or(ilike(busabaseBaseFields.name, pattern), ilike(busabaseBaseFields.slug, pattern)),
            ),
          )
      : Promise.resolve([]),
  ]);

  const baseIdsFromFields = fieldRows.map((field) => field.baseId);
  const extraBaseRows =
    baseIdsFromFields.length > 0
      ? await db
          .select()
          .from(busabaseBases)
          .where(
            and(
              inArray(busabaseBases.id, baseIdsFromFields),
              eq(busabaseBases.spaceId, spaceId),
              isNull(busabaseBases.archivedAt),
            ),
          )
      : [];
  const baseRowsById = new Map([...baseRows, ...extraBaseRows].map((base) => [base.id, base]));
  const allBaseIds = [...new Set([...baseRowsById.keys()])];
  const allBaseFields =
    allBaseIds.length > 0
      ? await db
          .select()
          .from(busabaseBaseFields)
          .where(inArray(busabaseBaseFields.baseId, allBaseIds))
      : [];

  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  const changeRequestsById = new Map(
    changeRequestRows.map((changeRequest) => [changeRequest.id, changeRequest]),
  );
  const [projectionResults, fileSearch] = await Promise.all([
    Promise.all(
      projectionRows.slice(0, parsed.limit).flatMap((row) => {
        if (row.recordId) {
          const record = recordsById.get(row.recordId);
          return record ? [hydrateRecord(record).then(toRecordSearchResult)] : [];
        }
        if (row.changeRequestId) {
          const changeRequest = changeRequestsById.get(row.changeRequestId);
          return changeRequest
            ? [hydrateChangeRequest(changeRequest).then(toChangeRequestSearchResult)]
            : [];
        }
        return [];
      }),
    ),
    wantsFiles
      ? searchAssetBackedFiles(query, parsed.limit)
      : Promise.resolve({ results: [] as SearchResultVO[], truncated: false }),
  ]);

  // Node CONTENT. Only on the first page: like `names`, these are not part of
  // the `projectionRows` pagination cursor, so emitting them again on every
  // page would duplicate them.
  const nodeContent =
    wantsNodes && parsed.offset === 0
      ? await searchNodeContent(db, spaceId, query, parsed.limit)
      : { results: [] as SearchResultVO[], truncated: false };

  const baseResults = [...baseRowsById.values()].map((base) =>
    toBaseSearchResult(
      toBaseVO(
        base,
        allBaseFields.filter((field) => field.baseId === base.id),
        // `{}` is deliberate, not a shortcut: this VO only feeds
        // `toBaseSearchResult` below, which never reads `.metadata`. The two
        // queries this Base row can come from (`name`/`description`/`slug`
        // match and the field-name match) are two separate fan-out branches
        // merged by id into `baseRowsById` — joining `busabaseNodes` into both
        // just to thread a value nothing consumes would be real, avoidable
        // query cost for zero behavior change.
        {},
      ),
    ),
  );

  const dedupedResults = new Map<string, SearchResultVO>();
  for (const result of [
    ...projectionResults,
    ...baseResults,
    ...fileSearch.results,
    ...nodeContent.results,
  ]) {
    dedupedResults.set(`${result.kind}:${result.id}`, result);
  }
  const results = [...dedupedResults.values()].slice(0, parsed.limit);

  return {
    // Reported even when this page has hits: it says the ANSWER may be
    // incomplete, which is exactly what a caller needs in order to describe an
    // empty or thin result honestly (spec D2b). ORed across every source that
    // can be capped — node content and file content are two independent ways
    // the same promise can break.
    contentTruncated: nodeContent.truncated || fileSearch.truncated,
    hasMore: projectionRows.length > parsed.limit,
    limit: parsed.limit,
    offset: parsed.offset,
    query,
    results,
  };
};
