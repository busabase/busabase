import "server-only";

import {
  countRecordsInputSchema,
  listRecordsInputSchema,
} from "busabase-contract/domains/base/contract/record-schemas";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveUserRefs } from "../../../context";
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
import { hydrateRecord, hydrateRecords } from "../../../logic/cr-lifecycle";
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
  const users = await resolveUserRefs(viewRows.map((view) => view.createdBy));
  return viewRows.map((view) => toViewVO(view, users));
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
  return hydrateRecords(recordRows);
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

// Field types whose text/number/boolean projection into busabaseFieldValues is
// faithful, so a filter on them can be pushed to SQL. Everything else (select /
// relation / multiselect / json / date) is left to the client filter, which
// stays authoritative.
const PUSHABLE_TEXT_TYPES = new Set([
  "text",
  "longtext",
  "markdown",
  "html",
  "url",
  "embed",
  "email",
  "phone",
  "code",
]);
const PUSHABLE_NUMBER_TYPES = new Set(["number", "auto_number"]);

// Translate one view filter to a SUPERSET-safe SQL predicate (an EXISTS over the
// record's projected field values), or null when it can't be pushed (the client
// then handles it). Superset = never excludes a record the client would keep, so
// pushing is always a pure narrowing optimization on top of the client filter.
const buildPushableRecordFilter = (
  db: Awaited<ReturnType<typeof getDb>>,
  filter: { fieldSlug: string; fieldType?: string; operator: string; value?: unknown },
): SQL | null => {
  const type = filter.fieldType ?? "";
  const isTextLike = PUSHABLE_TEXT_TYPES.has(type);
  const isNumberLike = PUSHABLE_NUMBER_TYPES.has(type);

  const matches = (predicate: SQL): SQL =>
    exists(
      db
        .select({ one: sql`1` })
        .from(busabaseFieldValues)
        .where(
          and(
            eq(busabaseFieldValues.recordId, busabaseRecords.id),
            eq(busabaseFieldValues.fieldSlug, filter.fieldSlug),
            isNull(busabaseFieldValues.deletedAt),
            predicate,
          ),
        ),
    );

  // contains / equals → substring match on the faithful text projection.
  // `equals` is deliberately widened to a substring (superset); the client
  // narrows it to an exact match. No LIKE-escaping, so we never match LESS.
  if (
    (filter.operator === "contains" || filter.operator === "equals") &&
    (isTextLike || isNumberLike)
  ) {
    return matches(ilike(busabaseFieldValues.valueText, `%${String(filter.value ?? "")}%`));
  }
  if (filter.operator === "not_empty" && (isTextLike || isNumberLike)) {
    return matches(
      and(isNotNull(busabaseFieldValues.valueText), ne(busabaseFieldValues.valueText, "")) as SQL,
    );
  }
  if (filter.operator === "is_true" && type === "checkbox") {
    return matches(eq(busabaseFieldValues.valueBool, true));
  }
  // is_empty / is_false / select / relation / multiselect / json / date → client.
  return null;
};

// Which typed value column a sort field maps to. Only number/date sort in SQL —
// their column ordering matches the client's (numeric / chronological). text and
// other types keep the client's locale-aware sort (and stay a client concern).
const SORT_DATE_TYPES = new Set(["date"]);
const sortColumnFor = (
  fieldType?: string,
):
  | { col: typeof busabaseFieldValues.valueNumber; kind: "number" }
  | { col: typeof busabaseFieldValues.valueDate; kind: "date" }
  | null => {
  if (fieldType && PUSHABLE_NUMBER_TYPES.has(fieldType)) {
    return { col: busabaseFieldValues.valueNumber, kind: "number" };
  }
  if (fieldType && SORT_DATE_TYPES.has(fieldType)) {
    return { col: busabaseFieldValues.valueDate, kind: "date" };
  }
  return null;
};

// Sort cursor = base64 JSON of the row's sort value (null-safe) + its id.
const encodeSortCursor = (value: number | Date | null, id: string): string =>
  Buffer.from(
    JSON.stringify({ v: value instanceof Date ? value.toISOString() : value, id }),
    "utf8",
  ).toString("base64");

const decodeSortCursor = (
  cursor: string,
  kind: "number" | "date",
): { value: number | Date | null; id: string } | null => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
    if (typeof parsed?.id !== "string") return null;
    if (parsed.v === null || parsed.v === undefined) {
      return { value: null, id: parsed.id };
    }
    if (kind === "date") {
      const date = new Date(parsed.v);
      return Number.isNaN(date.getTime()) ? null : { value: date, id: parsed.id };
    }
    const num = Number(parsed.v);
    return Number.isNaN(num) ? null : { value: num, id: parsed.id };
  } catch {
    return null;
  }
};

/**
 * Keyset-paginated record list. Default order is (createdAt DESC, id DESC). When
 * a number/date `sort` is given it pushes down: LEFT JOINs the field value and
 * orders by that typed column (NULLS LAST, id ASC tiebreak), so a sorted big base
 * paginates server-side instead of loading every page into the browser.
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
  // Best-effort server-side view-filter push-down (superset; the client filter
  // stays authoritative). Non-pushable filters are skipped here. Applies to both
  // the sort and default paths below.
  if (parsed.filters) {
    for (const filter of parsed.filters) {
      const condition = buildPushableRecordFilter(db, filter);
      if (condition) {
        filters.push(condition);
      }
    }
  }

  const sortInfo = parsed.sort ? sortColumnFor(parsed.sort.fieldType) : null;
  if (parsed.sort && sortInfo) {
    // ── Sort-field keyset path (number/date). ORDER BY the typed value column
    // NULLS LAST, id ASC as a stable tiebreaker. The keyset predicate mirrors
    // that ordering so paging never skips or repeats a row. ──
    const { col: sortCol, kind } = sortInfo;
    const direction = parsed.sort.direction;
    if (parsed.cursor) {
      const decoded = decodeSortCursor(parsed.cursor, kind);
      if (decoded) {
        const { value: cv, id: cid } = decoded;
        if (cv === null) {
          // Cursor is already in the trailing NULL bucket: only later nulls (by id).
          filters.push(and(isNull(sortCol), gt(busabaseRecords.id, cid)) as SQL);
        } else {
          const valueAfter = direction === "asc" ? gt(sortCol, cv) : lt(sortCol, cv);
          filters.push(
            or(
              // NULLS LAST → every null row sorts after a non-null cursor row.
              isNull(sortCol),
              valueAfter,
              and(eq(sortCol, cv), gt(busabaseRecords.id, cid)),
            ) as SQL,
          );
        }
      }
    }
    const orderByValue =
      direction === "asc" ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`;
    const rows = await db
      .select({ record: busabaseRecords, sortValue: sortCol })
      .from(busabaseRecords)
      .leftJoin(
        busabaseFieldValues,
        and(
          eq(busabaseFieldValues.recordId, busabaseRecords.id),
          eq(busabaseFieldValues.fieldSlug, parsed.sort.fieldSlug),
          isNull(busabaseFieldValues.deletedAt),
        ),
      )
      .where(and(...filters))
      .orderBy(orderByValue, asc(busabaseRecords.id))
      .limit(parsed.limit + 1);

    const hasMore = rows.length > parsed.limit;
    const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeSortCursor(last.sortValue, last.record.id) : null;
    const records = await hydrateRecords(pageRows.map((row) => row.record));
    return { records, nextCursor };
  }

  // ── Default createdAt keyset path (unchanged). ──
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

  const records = await hydrateRecords(pageRows);
  return { records, nextCursor };
};

/**
 * Count active records in the current space (optionally scoped to a base).
 * Feeds the table header total so the UI can show "N of total" instead of
 * silently capping at a page size.
 */
export const countRecords = async (input?: z.input<typeof countRecordsInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = countRecordsInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.status, "active"),
  ];
  if (parsed.baseId) {
    filters.push(eq(busabaseRecords.baseId, parsed.baseId));
  }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseRecords)
    .where(and(...filters));
  return { total: row?.count ?? 0 };
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
  return hydrateRecords(
    recordIds
      .map((recordId) => recordsById.get(recordId))
      .filter((record): record is RecordPO => Boolean(record)),
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
  const users = await resolveUserRefs(viewRows.map((view) => view.createdBy));
  return viewRows.map((view) => toViewVO(view, users));
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
  return hydrateRecords(recordRows);
};
