import "server-only";

import type {
  ChangeRequestVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
} from "busabase-contract/types";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseChangeRequests,
  busabaseFieldValues,
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
      : String(
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
  body: `${base.description} ${base.fields.map((field) => `${field.name} ${field.slug}`).join(" ")}`,
  eyebrow: `${base.fields.length} fields · ${base.slug}`,
  href: `/base/${base.slug}`,
  updatedAt: base.createdAt,
});

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
  const projectionResults = await Promise.all(
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
  );

  const baseResults = [...baseRowsById.values()].map((base) =>
    toBaseSearchResult(
      toBaseVO(
        base,
        allBaseFields.filter((field) => field.baseId === base.id),
      ),
    ),
  );

  const dedupedResults = new Map<string, SearchResultVO>();
  for (const result of [...projectionResults, ...baseResults]) {
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
