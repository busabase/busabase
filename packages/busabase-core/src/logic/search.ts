import "server-only";

import type {
  ChangeRequestVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
} from "busabase-contract/types";
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
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
import { collectSubtreeIds } from "./nodes";
import { ensureReady } from "./seed";
import { toBaseVO } from "./vo";

// Mirrors `contract/schemas.ts`s SEARCH_SOURCES; `nodes` searches node CONTENT
// and is named to match grep's `nodes` source.
export const SEARCH_SOURCES = ["records", "files", "names", "nodes"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

/**
 * Mirrors `contract/schemas.ts`'s `SEARCH_SORTS`. `relevance` is not a column:
 * it means "let each source keep the ranking it has", which for records is the
 * full-text `ts_rank` and for everything else is most-recently-updated first.
 * That is what every caller got before this parameter existed, which is why it
 * is the default.
 */
export const SEARCH_SORTS = [
  "relevance",
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

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
  sort: z.enum(SEARCH_SORTS).optional().default("relevance"),
  updatedAfter: z.string().optional(),
  updatedBefore: z.string().optional(),
  inNodeId: z.string().optional(),
});

/**
 * The ORDER BY for one source, given its own created/updated columns.
 *
 * Each source is ordered by the SAME column the caller asked for, so a mixed
 * result set is actually comparable — sorting records by rank while sorting
 * files by mtime would produce a list whose order means nothing.
 */
const orderForSort = (
  sort: SearchSort,
  columns: { createdAt: PgColumn; updatedAt: PgColumn },
  // `PgColumn`, not `AnyColumn`: drizzle's `orderBy` rejects the wider type,
  // and widening it here only moves the error to the call site.
  relevanceFallback: SQL | PgColumn,
): SQL | PgColumn => {
  switch (sort) {
    case "updated_desc":
      return desc(columns.updatedAt);
    case "updated_asc":
      return asc(columns.updatedAt);
    case "created_desc":
      return desc(columns.createdAt);
    case "created_asc":
      return asc(columns.createdAt);
    default:
      return relevanceFallback;
  }
};

/**
 * A result paired with the value its own source was ORDERED BY.
 *
 * Every source already applies `orderForSort` in SQL, so each arrives
 * internally correct — but they are then concatenated, and concatenation order
 * (records, then Bases, then files, then node content) silently outranks the
 * order the caller asked for. Verified against a real server before this
 * existed: with `sort=updated_desc`, the newest document in the workspace came
 * back BELOW records an entire minute older, because records are concatenated
 * first. The list was sorted four times and ordered once.
 *
 * The key rides alongside the VO rather than being added to it: which column it
 * holds depends on the sort of this one call (`createdAt` for the `created_*`
 * orders, `updatedAt` otherwise), so it is a fact about the query, not a
 * property of the result.
 */
interface SortableResult {
  result: SearchResultVO;
  sortKey: string | null;
}

const sortKeyFor = (
  sort: SearchSort,
  timestamps: { createdAt: string | null; updatedAt: string | null },
) =>
  sort === "created_desc" || sort === "created_asc" ? timestamps.createdAt : timestamps.updatedAt;

/**
 * Flatten the per-source groups into the single list the caller sees.
 *
 * `relevance` deliberately keeps concatenation order: each source ranks by its
 * own notion of relevance (full-text rank for records, recency for everything
 * else), and those scores are not comparable across sources, so interleaving
 * them would invent a precision that isn't there. The four explicit orders DO
 * name one shared column, and those are the ones that get merged.
 */
const mergeBySort = (groups: SortableResult[][], sort: SearchSort): SearchResultVO[] => {
  const merged = groups.flat();
  if (sort === "relevance") return merged.map((entry) => entry.result);

  const ascending = sort === "updated_asc" || sort === "created_asc";
  const timeOf = (entry: SortableResult) => {
    if (entry.sortKey === null) return null;
    const parsed = Date.parse(entry.sortKey);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return (
    merged
      // Decorated with the original index so ties stay STABLE — two rows sharing
      // a timestamp (a bulk import; a change request and the records it wrote)
      // must not swap places between two identical requests, or paging through
      // them would skip and repeat rows.
      .map((entry, index) => ({ entry, index, time: timeOf(entry) }))
      .sort((a, b) => {
        // A row whose sort column is null cannot be placed in time. Park it
        // after everything that can be, in arrival order, rather than letting
        // `null` read as "the beginning of time" and head an ascending list.
        if (a.time === null || b.time === null) {
          if (a.time === b.time) return a.index - b.index;
          return a.time === null ? 1 : -1;
        }
        if (a.time === b.time) return a.index - b.index;
        return ascending ? a.time - b.time : b.time - a.time;
      })
      .map(({ entry }) => entry.result)
  );
};

/**
 * The narrowing a caller asked for, passed as one object rather than four
 * positional arguments — every source needs the same set, and a four-argument
 * tail is exactly where a future edit swaps two of them silently.
 */
export interface SearchNarrowing {
  sort: SearchSort;
  updatedAfter?: string;
  updatedBefore?: string;
  /** Already resolved to concrete ids; `undefined` means no restriction. */
  subtreeIds?: string[];
}

/**
 * Inclusive date-range predicate over whichever timestamp column a source
 * exposes. Both bounds optional; `undefined` when neither is set so callers can
 * drop it straight into `and(...)`.
 */
const dateRangeCondition = (
  column: PgColumn,
  input: { updatedAfter?: string; updatedBefore?: string },
) => {
  const parts: (SQL | undefined)[] = [];
  if (input.updatedAfter) parts.push(gte(column, new Date(input.updatedAfter)));
  if (input.updatedBefore) parts.push(lte(column, new Date(input.updatedBefore)));
  return parts.length > 0 ? and(...parts) : undefined;
};

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
  narrow: SearchNarrowing,
): Promise<{ results: SortableResult[]; truncated: boolean }> => {
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
      createdAt: busabaseNodes.createdAt,
      updatedAt: busabaseNodes.updatedAt,
    })
    .from(busabaseNodeContentSearch)
    .innerJoin(busabaseNodes, eq(busabaseNodeContentSearch.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodeContentSearch.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
        dateRangeCondition(busabaseNodes.updatedAt, narrow),
        narrow.subtreeIds ? inArray(busabaseNodes.id, narrow.subtreeIds) : undefined,
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
    .orderBy(
      orderForSort(
        narrow.sort,
        { createdAt: busabaseNodes.createdAt, updatedAt: busabaseNodes.updatedAt },
        desc(busabaseNodes.updatedAt),
      ),
    )
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
      result: {
        id: row.nodeId,
        kind: "node" as const,
        title: row.name,
        body: buildNodeSnippet(row.contentText ?? "", query),
        eyebrow: NODE_KIND_LABEL[row.nodeType] ?? row.nodeType,
        href: fileResultHref(row.nodeType, row.slug),
        updatedAt: row.updatedAt?.toISOString() ?? null,
      },
      sortKey: sortKeyFor(narrow.sort, {
        createdAt: row.createdAt?.toISOString() ?? null,
        updatedAt: row.updatedAt?.toISOString() ?? null,
      }),
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
  createdAt: busabaseAssetUsages.createdAt,
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
  narrow: SearchNarrowing,
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
        dateRangeCondition(busabaseAssetUsages.updatedAt, narrow),
        narrow.subtreeIds ? inArray(busabaseAssetUsages.nodeId, narrow.subtreeIds) : undefined,
        extraCondition,
      ),
    )
    .orderBy(
      orderForSort(
        narrow.sort,
        { createdAt: busabaseAssetUsages.createdAt, updatedAt: busabaseAssetUsages.updatedAt },
        desc(busabaseAssetUsages.updatedAt),
      ),
    )
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
    // The owning NODE's identity counts for DOCUMENT holders, not code holders.
    //
    // `file` — the node IS the file, and its name is the file's visible name,
    // often nothing like the stored filename ("Finance upload" holding
    // `quarterly.txt`). `drive` — a place a person puts documents, where
    // "what is in my Finance Drive" is a real question and the drive's name is
    // the only handle on it. Both are pinned by existing tests
    // (`search-asset-content.test.ts`, `search-text-convergence.test.ts`).
    //
    // `airapp` / `skill` are programs. Their files are SOURCE, generated from a
    // scaffold, and nobody searching an app's name is asking for its
    // `package.json`. Observed: an AirApp called "Quokka Tracker" answered
    // "quokka" with `style.css`, `server.js` and `client.js` — none of which
    // contain the query — alongside the node itself, already listed above them
    // under its own name.
    //
    // The line is therefore what the files ARE, not whether the node is a
    // container: documents get their holder's name, source code does not.
    and(
      inArray(busabaseNodes.type, ["file", "drive"]),
      or(
        ilike(busabaseNodes.name, pattern),
        ilike(busabaseNodes.description, pattern),
        ilike(busabaseNodes.slug, pattern),
      ),
    ),
  );

const rowResultKey = (row: AssetUsageRow): string =>
  `${row.assetId}:${row.nodeId}:${row.usagePath}:${row.recordId}:${row.fieldSlug}:${row.blockId}`;

/**
 * `toFileSearchResult` plus the key the global merge sorts on. The asset
 * USAGE's timestamps, not the asset's: a file's search result is the usage —
 * the same asset attached to two records is two results — and the usage is also
 * what `queryAssetUsageRows` filters and orders by.
 */
const toSortableFileResult = (
  row: AssetUsageRow,
  body: string,
  sort: SearchSort,
): SortableResult => ({
  result: toFileSearchResult(row, body),
  sortKey: sortKeyFor(sort, {
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }),
});

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
  narrow: SearchNarrowing,
): Promise<{ results: SortableResult[]; scannedAllEligible: boolean }> => {
  const rows = await queryAssetUsageRows(db, spaceId, undefined, MAX_ASSET_USAGE_SCAN_ROWS, narrow);

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
  const results: SortableResult[] = [];

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
    results.push(toSortableFileResult(row, matchedLine, narrow.sort));
    if (results.length >= limit) {
      break;
    }
  }
  return { results, scannedAllEligible: !overCap };
};

const searchAssetBackedFiles = async (
  query: string,
  limit: number,
  narrow: SearchNarrowing,
): Promise<{ results: SortableResult[]; truncated: boolean }> => {
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
    narrow,
  );
  const identityResults = identityRows.map((row) =>
    toSortableFileResult(
      row,
      [row.nodeDescription, row.usagePath, row.fileName].filter(Boolean).join(" "),
      narrow.sort,
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
    narrow,
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

  /**
   * `inNodeId` resolved to the concrete set of node ids it covers.
   *
   * Done once here rather than per source: all four need the same answer, and
   * the walk costs one query per tree LEVEL, not per source. `undefined` when
   * the caller passed no `inNodeId`, which every condition below treats as
   * "no restriction" rather than "restrict to nothing".
   */
  const subtreeIds = parsed.inNodeId ? await collectSubtreeIds(db, parsed.inNodeId) : undefined;
  const narrowing: SearchNarrowing = {
    sort: parsed.sort,
    updatedAfter: parsed.updatedAfter,
    updatedBefore: parsed.updatedBefore,
    subtreeIds,
  };

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
            // "A field value edited inside the window" — filtered before the
            // GROUP BY, so it reads as "this record was touched then" rather
            // than needing a HAVING over the aggregate.
            dateRangeCondition(busabaseFieldValues.updatedAt, parsed),
            // A field value knows its Base, and a Base knows its node — which
            // is what `inNodeId` is expressed in.
            subtreeIds
              ? exists(
                  db
                    .select({ one: sql`1` })
                    .from(busabaseBases)
                    .where(
                      and(
                        eq(busabaseBases.id, busabaseFieldValues.baseId),
                        inArray(busabaseBases.nodeId, subtreeIds),
                      ),
                    ),
                )
              : undefined,
          ),
        )
        .groupBy(busabaseFieldValues.recordId, busabaseFieldValues.changeRequestId)
        .orderBy(
          ...(parsed.sort === "relevance"
            ? [
                desc(
                  sql`max(ts_rank(to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')), plainto_tsquery('simple', ${query})))`,
                ),
                desc(sql`max(${busabaseFieldValues.updatedAt})`),
              ]
            : // Grouped, so the sort column has to be an aggregate too. `max`
              // for the newest-first orders and `min` for oldest-first, so a
              // record with many edited values sorts by the edge the caller
              // actually asked about rather than an arbitrary one.
              [
                parsed.sort === "updated_desc"
                  ? desc(sql`max(${busabaseFieldValues.updatedAt})`)
                  : parsed.sort === "updated_asc"
                    ? asc(sql`min(${busabaseFieldValues.updatedAt})`)
                    : parsed.sort === "created_desc"
                      ? desc(sql`max(${busabaseFieldValues.createdAt})`)
                      : asc(sql`min(${busabaseFieldValues.createdAt})`),
              ]),
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
          // `getTableColumns` keeps the row FLAT. A bare `.select()` with a
          // join returns `{ busabase_bases: {...}, busabase_nodes: {...} }`,
          // which every consumer of these rows below would have to unwrap —
          // the join exists only to reach the node's timestamps, not to add
          // columns to the result.
          .select({
            ...getTableColumns(busabaseBases),
            // The node's timestamps, NOT the Base's `createdAt`. This query
            // both filters and orders by `busabaseNodes.updatedAt` (see below),
            // so the global merge has to be handed the same value — sorting the
            // merged list by a column the row was not selected on is how a
            // "sorted" list ends up in an order nobody asked for.
            nodeCreatedAt: busabaseNodes.createdAt,
            nodeUpdatedAt: busabaseNodes.updatedAt,
          })
          .from(busabaseBases)
          // `busabase_bases` carries only `createdAt` — no `updatedAt`, no
          // creator. Its owning NODE has both, so date, author and sort all
          // resolve through the node rather than being faked from `createdAt`
          // or silently dropping Bases whenever one of those filters is used.
          // Dropping them would look like "no Bases matched", which is the
          // failure mode this whole series exists to remove.
          .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
          .where(
            and(
              eq(busabaseBases.spaceId, spaceId),
              isNull(busabaseBases.archivedAt),
              buildNodeVisibilityExists(db, busabaseBases.nodeId),
              dateRangeCondition(busabaseNodes.updatedAt, narrowing),
              subtreeIds ? inArray(busabaseBases.nodeId, subtreeIds) : undefined,
              or(
                ilike(busabaseBases.name, pattern),
                ilike(busabaseBases.description, pattern),
                ilike(busabaseBases.slug, pattern),
              ),
            ),
          )
          .orderBy(
            orderForSort(
              narrowing.sort,
              { createdAt: busabaseNodes.createdAt, updatedAt: busabaseNodes.updatedAt },
              desc(busabaseNodes.updatedAt),
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
              // A field has no timestamps or creator of its own; it inherits
              // its Base's node, same as the Base query above.
              narrowing.updatedAfter || narrowing.updatedBefore || subtreeIds
                ? exists(
                    db
                      .select({ one: sql`1` })
                      .from(busabaseBases)
                      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
                      .where(
                        and(
                          eq(busabaseBases.id, busabaseBaseFields.baseId),
                          dateRangeCondition(busabaseNodes.updatedAt, narrowing),
                          subtreeIds ? inArray(busabaseBases.nodeId, subtreeIds) : undefined,
                        ),
                      ),
                  )
                : undefined,
              or(ilike(busabaseBaseFields.name, pattern), ilike(busabaseBaseFields.slug, pattern)),
            ),
          )
      : Promise.resolve([]),
  ]);

  const baseIdsFromFields = fieldRows.map((field) => field.baseId);
  const extraBaseRows =
    baseIdsFromFields.length > 0
      ? await db
          // Same shape as the name-match branch above, node join included. The
          // two are merged by id into one map, so a Base reached through a FIELD
          // name has to carry the same timestamps as one reached through its own
          // name — otherwise it has no sort key, and every explicit sort order
          // quietly parks it at the bottom of the list.
          .select({
            ...getTableColumns(busabaseBases),
            nodeCreatedAt: busabaseNodes.createdAt,
            nodeUpdatedAt: busabaseNodes.updatedAt,
          })
          .from(busabaseBases)
          .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
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
          return record
            ? [
                hydrateRecord(record).then((vo) => ({
                  result: toRecordSearchResult(vo),
                  sortKey: sortKeyFor(parsed.sort, vo),
                })),
              ]
            : [];
        }
        if (row.changeRequestId) {
          const changeRequest = changeRequestsById.get(row.changeRequestId);
          return changeRequest
            ? [
                hydrateChangeRequest(changeRequest).then((vo) => ({
                  result: toChangeRequestSearchResult(vo),
                  sortKey: sortKeyFor(parsed.sort, vo),
                })),
              ]
            : [];
        }
        return [];
      }),
    ),
    wantsFiles
      ? searchAssetBackedFiles(query, parsed.limit, narrowing)
      : Promise.resolve({ results: [] as SortableResult[], truncated: false }),
  ]);

  // Node CONTENT. Only on the first page: like `names`, these are not part of
  // the `projectionRows` pagination cursor, so emitting them again on every
  // page would duplicate them.
  const nodeContent =
    wantsNodes && parsed.offset === 0
      ? await searchNodeContent(db, spaceId, query, parsed.limit, narrowing)
      : { results: [] as SortableResult[], truncated: false };

  const baseResults = [...baseRowsById.values()].map((base) => ({
    result: toBaseSearchResult(
      toBaseVO(
        base,
        allBaseFields.filter((field) => field.baseId === base.id),
        // `{}` is deliberate, not a shortcut: this VO only feeds
        // `toBaseSearchResult` below, which never reads `.metadata`. The two
        // queries this Base row can come from (`name`/`description`/`slug`
        // match and the field-name match) are two separate fan-out branches
        // merged by id into `baseRowsById`; both join `busabaseNodes` so the row
        // carries the timestamps `sortKey` below needs.
        {},
      ),
    ),
    // The Base row's own `createdAt` is deliberately NOT used: the query
    // filtered and ordered on the owning node, so the merge has to see the same
    // instant. A Base renamed long after it was created would otherwise sort as
    // though nothing had happened to it.
    sortKey: sortKeyFor(parsed.sort, {
      createdAt: base.nodeCreatedAt?.toISOString() ?? null,
      updatedAt: base.nodeUpdatedAt?.toISOString() ?? null,
    }),
  }));

  const dedupedResults = new Map<string, SortableResult>();
  for (const entry of [
    ...projectionResults,
    ...baseResults,
    ...fileSearch.results,
    ...nodeContent.results,
  ]) {
    dedupedResults.set(`${entry.result.kind}:${entry.result.id}`, entry);
  }
  // Merge FIRST, slice second. Slicing per-source order and then sorting the
  // survivors would return whichever 20 happened to be concatenated first,
  // re-ordered — an answer that looks sorted and is simply the wrong 20.
  const results = mergeBySort([[...dedupedResults.values()]], parsed.sort).slice(0, parsed.limit);

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
