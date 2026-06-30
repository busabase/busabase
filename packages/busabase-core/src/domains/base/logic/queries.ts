import "server-only";

import { listRecordsInputSchema } from "busabase-contract/domains/base/contract/record-schemas";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import type { RecordPO } from "../../../db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseFieldValues,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
} from "../../../db/schema";
import { hydrateRecord } from "../../../logic/cr-lifecycle";
import { ensureReady } from "../../../logic/seed";
import { listInputSchema, recordFieldFilterInputSchema } from "../../../logic/store";
import { toBaseVO, toFieldVO, toRecordLinkVO, toViewVO } from "../../../logic/vo";

export { listInputSchema, recordFieldFilterInputSchema };

export const listBases = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select()
    .from(busabaseBases)
    .where(and(eq(busabaseBases.spaceId, spaceId), isNull(busabaseBases.archivedAt)))
    .orderBy(asc(busabaseBases.createdAt));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.spaceId, spaceId), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return baseRows.map((base) =>
    toBaseVO(
      base,
      fieldRows.filter((field) => field.baseId === base.id),
    ),
  );
};

export const getBase = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Slug resolution prefers the ACTIVE base: after slug reuse an archived base
  // and a new active base can share a slug, and navigating to /base/<slug>
  // must land on the live one. (The id fallback below stays unfiltered so an
  // archived base is still reachable by id for the restore / notice flows.)
  const [base] = await db
    .select()
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.slug, baseId),
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.archivedAt),
      ),
    )
    .limit(1);
  const [baseById] = base
    ? [base]
    : await db
        .select()
        .from(busabaseBases)
        .where(and(eq(busabaseBases.id, baseId), eq(busabaseBases.spaceId, spaceId)))
        .limit(1);
  if (!baseById) {
    return null;
  }
  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseById.id), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return toBaseVO(baseById, fields);
};

export const listViews = async (baseId?: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = baseId ? await getBase(baseId) : null;
  const viewRows = resolvedBase
    ? await db
        .select()
        .from(busabaseViews)
        .where(and(eq(busabaseViews.baseId, resolvedBase.id), eq(busabaseViews.status, "active")))
        .orderBy(asc(busabaseViews.createdAt))
    : await db
        .select({ view: busabaseViews })
        .from(busabaseViews)
        .innerJoin(busabaseBases, eq(busabaseViews.baseId, busabaseBases.id))
        .where(
          and(
            eq(busabaseViews.spaceId, getContextSpaceId()),
            eq(busabaseViews.status, "active"),
            isNull(busabaseBases.archivedAt),
          ),
        )
        .orderBy(asc(busabaseViews.createdAt))
        .then((rows) => rows.map((r) => r.view));
  return viewRows.map(toViewVO);
};

export const listRecords = async (input?: z.input<typeof listInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listInputSchema.parse(input);
  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(eq(busabaseRecords.spaceId, getContextSpaceId()), eq(busabaseRecords.status, "active")),
    )
    .orderBy(desc(busabaseRecords.createdAt))
    .limit(parsed.limit);
  return Promise.all(recordRows.map(hydrateRecord));
};

// `|` separates the ISO timestamp (which itself contains colons) from the id.
const encodeRecordCursor = (createdAt: Date, recordId: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${recordId}`, "utf8").toString("base64");

const decodeRecordCursor = (cursor: string): { createdAt: Date; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

/**
 * Keyset-paginated record list. Orders by (createdAt DESC, id DESC) and walks
 * backwards via an opaque base64 `createdAt:id` cursor. Returns one extra row to
 * decide whether a `nextCursor` is owed.
 */
export const listRecordsPaged = async (input?: z.input<typeof listRecordsInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listRecordsInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.status, "active"),
  ];
  if (parsed.baseId) {
    filters.push(eq(busabaseRecords.baseId, parsed.baseId));
  }
  if (parsed.cursor) {
    const decoded = decodeRecordCursor(parsed.cursor);
    if (decoded) {
      // (createdAt, id) strictly less than the cursor for DESC ordering.
      filters.push(
        or(
          lt(busabaseRecords.createdAt, decoded.createdAt),
          and(eq(busabaseRecords.createdAt, decoded.createdAt), lt(busabaseRecords.id, decoded.id)),
        ) as SQL,
      );
    }
  }

  const rows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...filters))
    .orderBy(desc(busabaseRecords.createdAt), desc(busabaseRecords.id))
    .limit(parsed.limit + 1);

  const hasMore = rows.length > parsed.limit;
  const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeRecordCursor(last.createdAt, last.id) : null;

  const records = await Promise.all(pageRows.map(hydrateRecord));
  return { records, nextCursor };
};

export const getRecord = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
    .limit(1);
  return record ? hydrateRecord(record) : null;
};

export const listRecordLinks = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const links = await db
    .select()
    .from(busabaseRecordLinks)
    .where(
      and(
        eq(busabaseRecordLinks.spaceId, getContextSpaceId()),
        eq(busabaseRecordLinks.sourceRecordId, recordId),
        isNull(busabaseRecordLinks.deletedAt),
      ),
    )
    .orderBy(asc(busabaseRecordLinks.position), asc(busabaseRecordLinks.createdAt));
  return links.map(toRecordLinkVO);
};

export const listRecordsByFieldText = async (
  input: z.input<typeof recordFieldFilterInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = recordFieldFilterInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseFieldValues.spaceId, getContextSpaceId()),
    eq(busabaseFieldValues.fieldSlug, parsed.fieldSlug),
    eq(busabaseFieldValues.valueText, parsed.valueText),
    isNotNull(busabaseFieldValues.recordId),
    isNull(busabaseFieldValues.deletedAt),
  ];
  if (parsed.baseId) {
    filters.push(eq(busabaseFieldValues.baseId, parsed.baseId));
  }

  const projectionRows = await db
    .select()
    .from(busabaseFieldValues)
    .where(and(...filters))
    .orderBy(desc(busabaseFieldValues.createdAt))
    .limit(parsed.limit);
  const recordIds = projectionRows
    .map((row) => row.recordId)
    .filter((recordId): recordId is string => Boolean(recordId));

  if (recordIds.length === 0) {
    return [];
  }

  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.status, "active")));
  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  return Promise.all(
    recordIds
      .map((recordId) => recordsById.get(recordId))
      .filter((record): record is RecordPO => Boolean(record))
      .map(hydrateRecord),
  );
};

export const listArchivedBases = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select()
    .from(busabaseBases)
    .where(and(eq(busabaseBases.spaceId, spaceId), isNotNull(busabaseBases.archivedAt)))
    .orderBy(asc(busabaseBases.createdAt));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.spaceId, spaceId), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return baseRows.map((base) =>
    toBaseVO(
      base,
      fieldRows.filter((field) => field.baseId === base.id),
    ),
  );
};

export const listDeletedFields = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = await getBase(baseId);
  if (!resolvedBase) {
    return [];
  }
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(
      and(eq(busabaseBaseFields.baseId, resolvedBase.id), isNotNull(busabaseBaseFields.deletedAt)),
    )
    .orderBy(asc(busabaseBaseFields.position));
  return fieldRows.map(toFieldVO);
};

export const listArchivedViews = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = await getBase(baseId);
  if (!resolvedBase) {
    return [];
  }
  const viewRows = await db
    .select()
    .from(busabaseViews)
    .where(and(eq(busabaseViews.baseId, resolvedBase.id), eq(busabaseViews.status, "archived")))
    .orderBy(asc(busabaseViews.createdAt));
  return viewRows.map(toViewVO);
};

export const listArchivedRecords = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = await getBase(baseId);
  if (!resolvedBase) {
    return [];
  }
  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.baseId, resolvedBase.id), eq(busabaseRecords.status, "archived")))
    .orderBy(desc(busabaseRecords.createdAt));
  return Promise.all(recordRows.map(hydrateRecord));
};
