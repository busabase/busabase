import "server-only";

import type {
  ChangeRequestVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
} from "busabase-contract/types";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { iStringConcat, iStringParse, iStringSchema } from "openlib/i18n/i-string";
import { storage } from "openlib/storage";
import { z } from "zod";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetUsages,
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecords,
} from "../db/schema";
import { hydrateChangeRequest, hydrateRecord } from "./cr-lifecycle";
import { ensureReady } from "./seed";
import { toBaseVO } from "./vo";

// Schema defined locally to avoid circular deps with store.ts
export const searchInputSchema = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export const recordPrimaryText = (record: RecordVO): string => {
  const primarySlug = record.base.fields[0]?.slug;
  return (primarySlug ? String(record.headCommit.fields[primarySlug] ?? "") : "") || record.id;
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
  body: String(record.headCommit.fields.body ?? record.headCommit.fields.description ?? ""),
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
          changeRequest.primaryOperation?.headCommit.fields.title ??
            changeRequest.primaryOperation?.headCommit.fields.name ??
            changeRequest.id,
        ),
  body: changeRequest.operations
    .map((operation) => toSearchText(operation.headCommit.fields))
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

const fileMatchesQuery = (query: string, ...values: (string | null | undefined)[]) => {
  const lowerQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(lowerQuery));
};

const MAX_FILE_SEARCH_TEXT_BYTES = 256 * 1024;

// Upper bound on how many asset-usage rows a single search scans before
// falling back to metadata/body matching in JS. Without this, the query below
// pulled every asset usage in the space unconditionally — fine for a handful
// of files, but an unbounded full-table fetch (plus a JS loop over all of it)
// for any space that has accumulated a large asset library. Ordered by
// recency so the cap favors the files someone is most likely searching for.
const MAX_ASSET_USAGE_SCAN_ROWS = 1000;

const searchAssetBackedFiles = async (query: string, limit: number): Promise<SearchResultVO[]> => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const rows = await db
    .select({
      assetId: busabaseAssets.id,
      assetName: busabaseAssets.name,
      contentKind: busabaseAssets.contentKind,
      metadata: busabaseAssets.metadata,
      storageKey: attachments.storageKey,
      sizeBytes: attachments.sizeBytes,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      contentHash: attachments.contentHash,
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
    })
    .from(busabaseAssetUsages)
    .innerJoin(busabaseAssets, eq(busabaseAssetUsages.assetId, busabaseAssets.id))
    .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .innerJoin(busabaseNodes, eq(busabaseAssetUsages.nodeId, busabaseNodes.id))
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseAssetUsages.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .orderBy(desc(busabaseAssetUsages.updatedAt))
    .limit(MAX_ASSET_USAGE_SCAN_ROWS);
  const results: SearchResultVO[] = [];

  for (const row of rows) {
    // Cheap, already-in-memory columns. Most hits match here (name / path /
    // metadata), so we test them BEFORE ever reaching for the file body.
    const metaBody = [
      row.assetName,
      JSON.stringify(row.metadata ?? {}),
      JSON.stringify(row.usageMetadata ?? {}),
      row.fileName,
      row.mimeType,
      row.contentHash,
      row.usagePath,
      row.ownerType,
      row.fieldSlug,
      row.recordId,
      row.blockId,
      row.nodeName,
      row.nodeDescription,
      row.nodeSlug,
      row.nodeType,
    ]
      .filter(Boolean)
      .join(" ");

    let body = metaBody;
    if (!fileMatchesQuery(query, metaBody)) {
      // Only now — when metadata didn't already match — pay for the file body,
      // and only for text files within the size budget. A network/disk
      // getObject per row was the scalability hazard; a name-heavy query now
      // fills `limit` and returns without reading a single file.
      if (row.contentKind !== "text" || row.sizeBytes > MAX_FILE_SEARCH_TEXT_BYTES) {
        continue;
      }
      const textContent = await storage
        .getObject(row.storageKey)
        .then((bytes) => bytes.toString("utf8"))
        .catch(() => "");
      if (!fileMatchesQuery(query, textContent)) {
        continue;
      }
      body = `${metaBody} ${textContent}`;
    }
    results.push({
      id: `${row.assetId}:${row.nodeId}:${row.usagePath}:${row.recordId}:${row.fieldSlug}:${row.blockId}`,
      kind: "file",
      title:
        typeof row.usageMetadata.displayName === "string"
          ? row.usageMetadata.displayName
          : row.usagePath
            ? row.usagePath.split("/").at(-1) || row.assetName
            : row.assetName,
      body: body.slice(0, 280),
      eyebrow: `${row.nodeName} · ${row.ownerType}`,
      href: fileResultHref(row.nodeType, row.nodeSlug),
      updatedAt: row.updatedAt.toISOString(),
    });
    if (results.length >= limit) {
      return results;
    }
  }
  return results;
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

  const projectionRows = await db
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
    .offset(parsed.offset);

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
    parsed.offset === 0
      ? db
          .select()
          .from(busabaseBases)
          .where(
            and(
              eq(busabaseBases.spaceId, spaceId),
              isNull(busabaseBases.archivedAt),
              or(
                ilike(busabaseBases.name, pattern),
                ilike(busabaseBases.description, pattern),
                ilike(busabaseBases.slug, pattern),
              ),
            ),
          )
      : Promise.resolve([]),
    parsed.offset === 0
      ? db
          .select()
          .from(busabaseBaseFields)
          .where(
            and(
              eq(busabaseBaseFields.spaceId, spaceId),
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
  const [projectionResults, fileResults] = await Promise.all([
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
    searchAssetBackedFiles(query, parsed.limit),
  ]);

  const baseResults = [...baseRowsById.values()].map((base) =>
    toBaseSearchResult(
      toBaseVO(
        base,
        allBaseFields.filter((field) => field.baseId === base.id),
      ),
    ),
  );

  const dedupedResults = new Map<string, SearchResultVO>();
  for (const result of [...projectionResults, ...baseResults, ...fileResults]) {
    dedupedResults.set(`${result.kind}:${result.id}`, result);
  }
  const results = [...dedupedResults.values()].slice(0, parsed.limit);

  return {
    hasMore: projectionRows.length > parsed.limit,
    limit: parsed.limit,
    offset: parsed.offset,
    query,
    results,
  };
};
