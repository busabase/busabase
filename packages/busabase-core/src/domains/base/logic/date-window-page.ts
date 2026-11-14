import "server-only";

import type { listRecordsPageInputSchema } from "busabase-contract/domains/base/contract/record-schemas";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { getDb } from "../../../db";
import { busabaseFieldValues, busabaseRecords, type RecordPO } from "../../../db/schema";
import type { StatementBudget } from "./record-list-guards";

/** No newer active projection exists (same order as explicit sort). */
export const isLatestProjectedField = (db: Awaited<ReturnType<typeof getDb>>) => {
  const latest = alias(busabaseFieldValues, "newer_projected_field");
  const query = db
    .select({ one: sql`1` })
    .from(latest)
    .where(
      and(
        eq(latest.recordId, busabaseFieldValues.recordId),
        eq(latest.fieldSlug, busabaseFieldValues.fieldSlug),
        isNull(latest.deletedAt),
        or(
          gt(latest.createdAt, busabaseFieldValues.createdAt),
          and(
            eq(latest.createdAt, busabaseFieldValues.createdAt),
            gt(latest.id, busabaseFieldValues.id),
          ),
        ),
      ),
    )
    .$dynamic();
  return notExists(query);
};

type PageDateRange = NonNullable<z.infer<typeof listRecordsPageInputSchema>["dateRanges"]>[number];

/** Page-only lookup: the record id is already fixed by the date-index walk. */
const latestDateRangePredicate = (
  db: Awaited<ReturnType<typeof getDb>>,
  range: PageDateRange,
  recordId: SQL = sql`${busabaseRecords.id}`,
) => {
  const valueRow = alias(busabaseFieldValues, "latest_range_date");
  const query = db
    .select({ value: valueRow.valueDate })
    .from(valueRow)
    .where(
      and(
        eq(valueRow.recordId, recordId),
        eq(valueRow.fieldSlug, range.fieldSlug),
        isNull(valueRow.deletedAt),
      ),
    )
    .orderBy(desc(valueRow.createdAt), desc(valueRow.id))
    .limit(1);
  const value = sql`(${query.getSQL()})`;
  return and(
    range.gte === undefined
      ? undefined
      : gte(value, sql`${new Date(range.gte).toISOString()}::timestamp`),
    range.lt === undefined
      ? undefined
      : lt(value, sql`${new Date(range.lt).toISOString()}::timestamp`),
  ) as SQL;
};

/**
 * Find a scoped chronological page from typed projections. Materializing the
 * other date fields first lets PostgreSQL hash their candidate ids instead of
 * making a random end-date lookup for every historical start date. This is a
 * superset only: newest values and record visibility are checked on bounded
 * ordered batches before a record counts towards the page.
 */
export const selectDateOrderedPageRows = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
  where: SQL[],
  sort: { fieldSlug: string; direction: "asc" | "desc" },
  ranges: PageDateRange[],
  otherRanges: PageDateRange[],
  page: { limit: number; offset: number },
  budgeted: StatementBudget,
): Promise<RecordPO[]> => {
  const eligibleSets = otherRanges.map((range, index) => ({
    name: sql.identifier(`date_eligible_${index}`),
    query: sql`select ${busabaseFieldValues.recordId} as record_id from ${busabaseFieldValues} where ${and(
      eq(busabaseFieldValues.baseId, baseId),
      eq(busabaseFieldValues.fieldSlug, range.fieldSlug),
      isNull(busabaseFieldValues.deletedAt),
      isNotNull(busabaseFieldValues.recordId),
      range.gte === undefined ? undefined : gte(busabaseFieldValues.valueDate, new Date(range.gte)),
      range.lt === undefined ? undefined : lt(busabaseFieldValues.valueDate, new Date(range.lt)),
    )}`,
  }));
  const ctes = eligibleSets.length
    ? sql`with ${sql.join(
        eligibleSets.map(({ name, query }) => sql`${name} as materialized (${query})`),
        sql`, `,
      )}`
    : sql``;
  const joins = sql.join(
    eligibleSets.map(
      ({ name }) => sql`inner join ${name} on ${name}.record_id = ${busabaseFieldValues.recordId}`,
    ),
    sql` `,
  );
  const valueRow = alias(busabaseFieldValues, "page_latest_date");
  const latestDate = sql<string | null>`(${db
    .select({ value: valueRow.valueDate })
    .from(valueRow)
    .where(
      and(
        eq(valueRow.recordId, busabaseRecords.id),
        eq(valueRow.fieldSlug, sort.fieldSlug),
        isNull(valueRow.deletedAt),
      ),
    )
    .orderBy(desc(valueRow.createdAt), desc(valueRow.id))
    .limit(1)
    .getSQL()})::text`;
  const records: RecordPO[] = [];
  const seen = new Set<string>();
  const batchSize = Math.min(4096, Math.max(256, page.offset + page.limit + 1));
  let cursor: { date: string; id: string } | undefined;
  for (;;) {
    const after = cursor
      ? or(
          sort.direction === "asc"
            ? gt(busabaseFieldValues.valueDate, sql`${cursor.date}::timestamp`)
            : lt(busabaseFieldValues.valueDate, sql`${cursor.date}::timestamp`),
          and(
            eq(busabaseFieldValues.valueDate, sql`${cursor.date}::timestamp`),
            gt(busabaseFieldValues.recordId, cursor.id),
          ),
        )
      : undefined;
    const candidates = await budgeted(db, (tx) =>
      tx
        .select({
          id: sql<string>`date_candidates.record_id`,
          date: sql<string>`date_candidates.value_date::text`,
        })
        .from(sql`(${ctes}
      select ${busabaseFieldValues.recordId} as record_id, ${busabaseFieldValues.valueDate} as value_date
      from ${busabaseFieldValues} ${joins}
      where ${and(
        eq(busabaseFieldValues.baseId, baseId),
        eq(busabaseFieldValues.fieldSlug, sort.fieldSlug),
        isNull(busabaseFieldValues.deletedAt),
        isNotNull(busabaseFieldValues.recordId),
        after,
        ...ranges.flatMap((range) => [
          range.gte === undefined
            ? undefined
            : gte(busabaseFieldValues.valueDate, new Date(range.gte)),
          range.lt === undefined
            ? undefined
            : lt(busabaseFieldValues.valueDate, new Date(range.lt)),
        ]),
      )}
      order by ${busabaseFieldValues.valueDate} ${sort.direction === "asc" ? sql`asc` : sql`desc`}, ${busabaseFieldValues.recordId} asc
      limit ${batchSize}
    ) date_candidates`),
    );
    if (candidates.length === 0) return records;
    const validated = await budgeted(db, (tx) =>
      tx
        .select({ record: busabaseRecords, date: latestDate })
        .from(busabaseRecords)
        .where(
          and(
            ...where,
            inArray(busabaseRecords.id, [...new Set(candidates.map(({ id }) => id))]),
            ...otherRanges.map((range) => latestDateRangePredicate(db, range)),
          ),
        ),
    );
    const byId = new Map(validated.map((row) => [row.record.id, row]));
    for (const candidate of candidates) {
      const row = byId.get(candidate.id);
      // A stale start projection is only a candidate. Its current date must
      // equal this candidate's ordering key before the record can be emitted.
      if (!row || row.date !== candidate.date || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      if (seen.size > page.offset) records.push(row.record);
      if (records.length === page.limit) return records;
    }
    if (candidates.length < batchSize) return records;
    const last = candidates.at(-1);
    if (!last) return records;
    // Equal (date,id) candidates are the same record even when several old
    // projections share that date; skipping their remaining duplicates is safe.
    cursor = { date: last.date, id: last.id };
  }
};
