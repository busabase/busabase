import "server-only";

import type {
  BaseFieldVO,
  ViewFilterConditionVO,
  ViewFilterVO,
  ViewSortVO,
} from "busabase-contract/types";
import { isViewFilterGroup } from "busabase-contract/types";
import { and, eq, inArray, isNotNull, isNull, not, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { getDb } from "../../../db";
import { busabaseBaseFields, busabaseFieldValues, busabaseRecords } from "../../../db/schema";
import { VALUE_TEXT_INDEX_LIMIT } from "../../../logic/vo";
import {
  filterEvaluableRecordsByViewFilters,
  getViewFieldPreviewText,
} from "../utils/view-records";
import { lookupDependentFieldSlugs } from "./lookup-formulas";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Saved-view filters and sorts, decided in SQL where the answer is PROVABLY the
 * one `utils/view-records.ts` gives.
 *
 * The view matcher and comparator work on a field's preview text — select
 * labels, `#` auto-numbers, a date's sortable key in the field's zone,
 * case-folded with `toLowerCase`, ordered with `localeCompare(…, { numeric:
 * true, sensitivity: "base" })`. Re-deriving each of those in SQL would be a
 * second copy of the semantics that drifts (ILIKE folds case per the database's
 * locale, not like `toLowerCase`; Postgres has no ICU collation that matches
 * V8's). So this does not translate them. It reads the DISTINCT stored texts of
 * the field (`busabase_field_values.value_text`), runs the real matcher and
 * comparator on those few values in process, and hands SQL only the result: the
 * set of texts that match, or each text's rank in the comparator's order.
 *
 * That is exact as long as a field's stored text, passed to the matcher in place
 * of the stored value, renders the same preview — which holds for the types in
 * `STAND_IN_TYPES` once a per-field probe rules out the few shapes where it
 * would not (JSON values, truncated text, a number in a select, …). Anything the
 * probe cannot vouch for is left to the in-process evaluation, which then runs
 * over the rows the provable conditions already narrowed down to.
 */

/**
 * Field types whose `value_text` can stand in for the stored value. The flags
 * say whether a row projected from a number or a boolean value still renders
 * the same: a select maps only string ids to labels (a stray number renders
 * as ""), a date only parses strings, a people field only formats strings, and
 * a currency number formats `true` as $1.00 but the text "true" as "true".
 */
const STAND_IN_TYPES: ReadonlyMap<string, { numbers: boolean; booleans: boolean }> = new Map([
  ["text", { numbers: true, booleans: true }],
  ["longtext", { numbers: true, booleans: true }],
  ["markdown", { numbers: true, booleans: true }],
  ["html", { numbers: true, booleans: true }],
  ["url", { numbers: true, booleans: true }],
  ["email", { numbers: true, booleans: true }],
  ["phone", { numbers: true, booleans: true }],
  ["code", { numbers: true, booleans: true }],
  ["number", { numbers: true, booleans: false }],
  ["auto_number", { numbers: true, booleans: true }],
  ["checkbox", { numbers: true, booleans: true }],
  ["select", { numbers: false, booleans: false }],
  ["date", { numbers: false, booleans: false }],
  ["created_time", { numbers: false, booleans: false }],
  ["updated_time", { numbers: false, booleans: false }],
  ["created_by", { numbers: false, booleans: false }],
  ["updated_by", { numbers: false, booleans: false }],
]);

/** More distinct values than this and the field is evaluated in process instead. */
const MAX_DISTINCT_VALUES = 10_000;
/** Upper bound on the total length of the distinct texts read back per field. */
const MAX_DISTINCT_CHARS = 4_000_000;
/** Upper bound on the JSON a single match set or rank map sends as a parameter. */
const MAX_PARAM_CHARS = 1_000_000;

/** The ordering the view comparator uses on preview texts — the same call, verbatim. */
const comparePreview = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

/** `fieldId` wins, as in `recordMatchesViewFilter`. */
const resolveFilterField = (fields: ReadonlyArray<BaseFieldVO>, filter: ViewFilterVO) =>
  fields.find((item) =>
    filter.fieldId ? item.id === filter.fieldId : item.slug === filter.fieldSlug,
  );

const collectLeaves = (conditions: ReadonlyArray<ViewFilterConditionVO>): ViewFilterVO[] =>
  conditions.flatMap((condition) =>
    isViewFilterGroup(condition) ? collectLeaves(condition.conditions) : [condition],
  );

interface FieldStats {
  /** Distinct stored texts, or null when there are too many to read back. */
  texts: string[] | null;
  hasJson: boolean;
  hasNumber: boolean;
  hasBoolean: boolean;
  maxLength: number;
}

/** One ranked sort: the comparator's order over a field's stored texts. */
interface RankedSort {
  slug: string;
  direction: "asc" | "desc";
  /** Stored text → rank; texts that compare equal share a rank. */
  rankJson: string;
  /** The rank of "no value" (no row, or a row without text). */
  missingRank: number;
}

export interface ViewSqlOrder {
  sorts: RankedSort[];
}

export interface ViewSqlPlan {
  /** Root conjuncts proven identical to the view matcher, as SQL to AND in. */
  pushed: SQL[];
  /** Root conjuncts the matcher still has to evaluate, over the narrowed rows. */
  residual: ViewFilterConditionVO[];
  /**
   * The order `compareRecordsByViewSort` gives (sorts, then `updatedAt desc`,
   * then `id desc`), to run with `selectOrderedRecordIds`; null when it can't
   * be proven or no order was asked for.
   */
  order: ViewSqlOrder | null;
  /** Slugs whose stored texts decided a filter or a sort — for tests and diagnostics. */
  decidedSlugs: string[];
}

export interface PlanViewSqlInput {
  baseId: string;
  fields: ReadonlyArray<BaseFieldVO>;
  /** Root conditions, ANDed (the shape `combineViewFilters` produces). */
  filters: ReadonlyArray<ViewFilterConditionVO>;
  /** The view's sorts, or null when the caller does not need an order. */
  sorts: ReadonlyArray<ViewSortVO> | null;
  /** The record scope (space, Base, status, visibility, …) the order is applied in. */
  scope: SQL[];
  /**
   * A predicate the caller has already proven exact for this leaf without
   * reading any data (see `isFilterExactlyPushable` in queries.ts). Tried
   * first, so a leaf it covers costs no planning read.
   */
  provenLeaf?: (filter: ViewFilterVO, field: BaseFieldVO) => SQL | null;
  /**
   * A last resort for a leaf whose stored texts can't decide it (too many
   * distinct values). `truncated` says whether any stored text of the field
   * reached the projection limit. Aggregates pass their pre-existing text
   * predicates here; listings pass nothing.
   */
  fallbackLeaf?: (filter: ViewFilterVO, field: BaseFieldVO, truncated: boolean) => SQL | null;
}

/** Rows of a raw `db.execute`: postgres-js returns them as the result, PGLite under `rows`. */
const toRows = (result: unknown): unknown[] =>
  Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);

/** Run raw SQL and return its rows, on either driver. */
export const executeRows = async <T>(db: Db, query: SQL): Promise<T[]> =>
  toRows(await db.execute(query)) as T[];

/**
 * One read for every field to decide: its distinct stored texts with what the
 * probe needs to know about them. Fields with too many distinct values (or too
 * much text) come back as a single summary row instead of their values.
 */
const loadFieldStats = async (
  db: Db,
  baseId: string,
  slugs: string[],
): Promise<Map<string, FieldStats>> => {
  const stats = new Map<string, FieldStats>();
  if (slugs.length === 0) return stats;
  const result = await db.execute(sql`
    select field_slug, value_text, n, chars, has_json, has_number, has_boolean, max_length
    from (
      select
        field_slug,
        value_text,
        count(*) over w as n,
        sum(coalesce(length(value_text), 0)) over w as chars,
        bool_or(has_json) over w as has_json,
        bool_or(has_number) over w as has_number,
        bool_or(has_boolean) over w as has_boolean,
        max(max_length) over w as max_length,
        row_number() over w as rn
      from (
        select
          ${busabaseFieldValues.fieldSlug} as field_slug,
          ${busabaseFieldValues.valueText} as value_text,
          bool_or(${busabaseFieldValues.valueJson} is not null) as has_json,
          bool_or(${busabaseFieldValues.valueNumber} is not null) as has_number,
          bool_or(${busabaseFieldValues.valueBool} is not null) as has_boolean,
          coalesce(max(length(${busabaseFieldValues.valueText})), 0) as max_length
        from ${busabaseFieldValues}
        where ${busabaseFieldValues.baseId} = ${baseId}
          and ${inArray(busabaseFieldValues.fieldSlug, slugs)}
          and ${busabaseFieldValues.deletedAt} is null
          and ${busabaseFieldValues.recordId} is not null
        group by 1, 2
      ) as per_text
      window w as (partition by field_slug)
    ) as per_field
    where (n <= ${MAX_DISTINCT_VALUES} and chars <= ${MAX_DISTINCT_CHARS}) or rn = 1
  `);
  const rows = toRows(result) as Array<{
    field_slug: string;
    value_text: string | null;
    n: number | string;
    chars: number | string;
    has_json: boolean;
    has_number: boolean;
    has_boolean: boolean;
    max_length: number | string;
  }>;
  for (const slug of slugs) {
    // A field nobody has written yet has no rows: every record renders it empty.
    stats.set(slug, {
      texts: [],
      hasJson: false,
      hasNumber: false,
      hasBoolean: false,
      maxLength: 0,
    });
  }
  for (const row of rows) {
    const decidable =
      Number(row.n) <= MAX_DISTINCT_VALUES && Number(row.chars) <= MAX_DISTINCT_CHARS;
    const entry = stats.get(row.field_slug);
    if (!entry) continue;
    entry.hasJson = Boolean(row.has_json);
    entry.hasNumber = Boolean(row.has_number);
    entry.hasBoolean = Boolean(row.has_boolean);
    entry.maxLength = Number(row.max_length);
    if (!decidable) entry.texts = null;
    else if (row.value_text !== null) entry.texts?.push(row.value_text);
  }
  return stats;
};

/**
 * Slugs that a soft-deleted field of this Base also used. A record written
 * before that field was deleted still carries its value under the slug in the
 * head commit, which the view matcher reads, while the projection tombstoned
 * it — so for these slugs the stored texts do not tell the whole story.
 */
const loadReusedSlugs = async (db: Db, baseId: string, slugs: string[]): Promise<Set<string>> => {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ slug: busabaseBaseFields.slug })
    .from(busabaseBaseFields)
    .where(
      and(
        eq(busabaseBaseFields.baseId, baseId),
        inArray(busabaseBaseFields.slug, slugs),
        isNotNull(busabaseBaseFields.deletedAt),
      ),
    );
  return new Set(rows.map((row) => row.slug));
};

/**
 * A Postgres `text[]` literal for one parameter. Unlike a list of parameters it
 * has no 65,535 ceiling, and unlike a subquery the planner sees the values (a
 * rare value then reads the trigram index, a common one the (base, field) one).
 */
const textArrayLiteral = (texts: readonly string[]): string =>
  `{${texts.map((text) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

/** Ids of records whose live projected text for `slug` is one of `texts`. */
const recordsWithText = (db: Db, baseId: string, slug: string, texts: readonly string[]) =>
  db
    .select({ recordId: busabaseFieldValues.recordId })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.baseId, baseId),
        eq(busabaseFieldValues.fieldSlug, slug),
        isNull(busabaseFieldValues.deletedAt),
        isNotNull(busabaseFieldValues.recordId),
        sql`${busabaseFieldValues.valueText} = any(${textArrayLiteral(texts)}::text[])`,
      ),
    );

export const planViewSql = async (db: Db, input: PlanViewSqlInput): Promise<ViewSqlPlan> => {
  const dynamicSlugs = lookupDependentFieldSlugs(input.fields);
  const fieldBySlug = new Map(input.fields.map((field) => [field.slug, field]));
  const standIn = (field: BaseFieldVO | undefined): field is BaseFieldVO =>
    field !== undefined && !dynamicSlugs.has(field.slug) && STAND_IN_TYPES.has(field.type);

  const leaves = collectLeaves(input.filters);
  const referenced = new Set<string>();
  for (const leaf of leaves) {
    const field = resolveFilterField(input.fields, leaf);
    if (field) referenced.add(field.slug);
  }
  for (const sort of input.sorts ?? []) referenced.add(sort.fieldSlug);
  // Even the predicates proven from the field type alone read the projection,
  // which a reused slug's old values are missing from.
  const reusedSlugs = await loadReusedSlugs(db, input.baseId, [...referenced]);

  // Leaves the caller can prove without reading data are settled first; only
  // the rest need the field's stored texts.
  const proven = new Map<ViewFilterVO, SQL>();
  const candidates = new Set<string>();
  for (const leaf of leaves) {
    const field = resolveFilterField(input.fields, leaf);
    if (!field || dynamicSlugs.has(field.slug) || reusedSlugs.has(field.slug)) continue;
    const predicate = input.provenLeaf?.(leaf, field) ?? null;
    if (predicate) proven.set(leaf, predicate);
    else if (standIn(field)) candidates.add(field.slug);
  }
  for (const sort of input.sorts ?? []) {
    const field = fieldBySlug.get(sort.fieldSlug);
    if (standIn(field) && !reusedSlugs.has(field.slug)) candidates.add(field.slug);
  }
  const stats = await loadFieldStats(db, input.baseId, [...candidates]);
  /** The field's stored texts, when they can stand in for its values. */
  const decidableTexts = (field: BaseFieldVO): string[] | null => {
    const entry = stats.get(field.slug);
    const rules = STAND_IN_TYPES.get(field.type);
    if (!entry?.texts || !rules || reusedSlugs.has(field.slug)) return null;
    if (entry.hasJson) return null;
    if (entry.hasNumber && !rules.numbers) return null;
    if (entry.hasBoolean && !rules.booleans) return null;
    // A text at the projection limit may have been cut short.
    if (entry.maxLength >= VALUE_TEXT_INDEX_LIMIT) return null;
    return entry.texts;
  };
  const decidedSlugs = new Set<string>();

  const compileLeaf = (leaf: ViewFilterVO): SQL | null => {
    const field = resolveFilterField(input.fields, leaf);
    // The matcher answers false for a field the Base no longer has.
    if (!field) return sql`false`;
    if (dynamicSlugs.has(field.slug)) return null;
    const settled = proven.get(leaf);
    if (settled) return settled;
    const texts = standIn(field) ? decidableTexts(field) : null;
    if (!texts) {
      if (!input.fallbackLeaf || reusedSlugs.has(field.slug)) return null;
      const entry = stats.get(field.slug);
      return input.fallbackLeaf(
        leaf,
        field,
        entry ? entry.maxLength >= VALUE_TEXT_INDEX_LIMIT : true,
      );
    }
    // The real matcher, on each stored text and on a record with no value.
    const probes = [
      ...texts.map((text) => ({ id: text, updatedAt: "", fields: { [field.slug]: text } })),
      { id: "", updatedAt: "", fields: {} as Record<string, unknown> },
    ];
    const passing = new Set(filterEvaluableRecordsByViewFilters(probes, input.fields, [leaf]));
    // A record matches when its text matches, or when it has no text and "no
    // value" matches. So when "no value" matches, the leaf is "has none of the
    // failing texts"; otherwise it is "has one of the matching texts".
    const missingMatches = passing.has(probes[probes.length - 1] as (typeof probes)[number]);
    const set = texts.filter(
      (_, index) => passing.has(probes[index] as (typeof probes)[number]) !== missingMatches,
    );
    if (textArrayLiteral(set).length > MAX_PARAM_CHARS) return null;
    decidedSlugs.add(field.slug);
    const hasOneOf = set.length
      ? inArray(busabaseRecords.id, recordsWithText(db, input.baseId, field.slug, set))
      : sql`false`;
    return missingMatches ? not(hasOneOf) : hasOneOf;
  };

  const compile = (condition: ViewFilterConditionVO): SQL | null => {
    if (!isViewFilterGroup(condition)) return compileLeaf(condition);
    // An empty nested group fails closed in the matcher.
    if (condition.conditions.length === 0) return sql`false`;
    const children: SQL[] = [];
    for (const child of condition.conditions) {
      const compiled = compile(child);
      if (!compiled) return null;
      children.push(compiled);
    }
    return (condition.conjunction === "or" ? or(...children) : and(...children)) as SQL;
  };

  const pushed: SQL[] = [];
  const residual: ViewFilterConditionVO[] = [];
  for (const condition of input.filters) {
    const compiled = compile(condition);
    if (compiled) pushed.push(compiled);
    else residual.push(condition);
  }

  let order: ViewSqlOrder | null = null;
  if (input.sorts) {
    const sorts: RankedSort[] = [];
    for (const sort of input.sorts) {
      const field = fieldBySlug.get(sort.fieldSlug);
      const texts = standIn(field) ? decidableTexts(field) : null;
      if (!field || !texts) break;
      // Rank every stored text, and "no value", in the comparator's own order;
      // texts that compare equal share a rank so the tiebreak decides them.
      const entries = [
        ...texts.map((text) => ({
          text: text as string | null,
          preview: getViewFieldPreviewText(field, text),
        })),
        { text: null as string | null, preview: getViewFieldPreviewText(field, undefined) },
      ].sort((left, right) => comparePreview(left.preview, right.preview));
      const ranks: Record<string, number> = {};
      let missingRank = 0;
      let rank = 0;
      entries.forEach((entry, index) => {
        const previous = entries[index - 1];
        if (previous && comparePreview(previous.preview, entry.preview) !== 0) rank++;
        if (entry.text === null) missingRank = rank;
        else ranks[entry.text] = rank;
      });
      const rankJson = JSON.stringify(ranks);
      if (rankJson.length > MAX_PARAM_CHARS) break;
      decidedSlugs.add(field.slug);
      sorts.push({ slug: field.slug, direction: sort.direction, rankJson, missingRank });
    }
    if (sorts.length === input.sorts.length) {
      // The comparator's tiebreak: `updatedAt` newest first at the millisecond
      // the row carries in process, then `id` by `localeCompare` — which is
      // code-point order only for ids made of [0-9a-z], as generated ids are.
      // Checked over the whole scope, not just the filtered rows: one cheap
      // scan, and any odd id leaves the order to the comparator.
      const [unusualId] = await db
        .select({ one: sql`1` })
        .from(busabaseRecords)
        .where(and(...input.scope, sql`${busabaseRecords.id} !~ '^[0-9a-z]+$'`))
        .limit(1);
      if (!unusualId) order = { sorts };
    }
  }

  return { pushed, residual, order, decidedSlugs: [...decidedSlugs] };
};

/**
 * The ids of the records matching `where`, in `order`, optionally one page of
 * them.
 *
 * Each sort reads its field's projected row through a LEFT JOIN on the record
 * id — not on the Base id: see the note on the sort join in `listRecordsPaged`
 * (queries.ts) for what a base_id predicate there did to the plan. The join is
 * wrapped in `DISTINCT ON (record id)` keeping the newest row (the choice
 * `buildPageSortOrder` makes), so a record with a duplicate projected row is
 * still listed once.
 */
export const selectOrderedRecordIds = async (
  db: Db,
  order: ViewSqlOrder,
  where: SQL[],
  page?: { limit: number; offset: number },
): Promise<string[]> => {
  if (order.sorts.length === 0) {
    // Only the tiebreak: no field to join, so no duplicate to collapse.
    const query = db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(and(...where))
      .orderBy(
        sql`date_trunc('milliseconds', ${busabaseRecords.updatedAt}) desc`,
        sql`${busabaseRecords.id} collate "C" desc`,
      )
      .$dynamic();
    const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;
    return rows.map((row) => row.id);
  }
  const keyRows = order.sorts.map((_, index) =>
    alias(busabaseFieldValues, `view_sort_row_${index}`),
  );
  const keyColumns = Object.fromEntries(
    keyRows.map((keyRow, index) => [
      `key${index}`,
      sql<string | null>`${keyRow.valueText}`.as(`view_sort_key_${index}`),
    ]),
  );
  let keyed = db
    .selectDistinctOn([busabaseRecords.id], {
      id: busabaseRecords.id,
      updatedAt: busabaseRecords.updatedAt,
      ...keyColumns,
    })
    .from(busabaseRecords)
    .$dynamic();
  order.sorts.forEach((sort, index) => {
    const keyRow = keyRows[index];
    if (!keyRow) return;
    keyed = keyed.leftJoin(
      keyRow,
      and(
        eq(keyRow.recordId, busabaseRecords.id),
        eq(keyRow.fieldSlug, sort.slug),
        isNull(keyRow.deletedAt),
      ),
    );
  });
  const ordered = keyed
    .where(and(...where))
    .orderBy(
      busabaseRecords.id,
      ...keyRows.flatMap((keyRow) => [
        sql`${keyRow.createdAt} desc nulls last`,
        sql`${keyRow.id} desc nulls last`,
      ]),
    )
    .as("view_ordered");
  const terms = [
    ...order.sorts.map((sort, index) => {
      // The rank map is one parameter, evaluated once per query.
      const key = sql`coalesce(((select ${sort.rankJson}::jsonb) ->> ${sql.identifier("view_ordered")}.${sql.identifier(`view_sort_key_${index}`)})::int, ${sort.missingRank}::int)`;
      return sort.direction === "asc" ? sql`${key} asc` : sql`${key} desc`;
    }),
    sql`date_trunc('milliseconds', ${ordered.updatedAt}) desc`,
    sql`${ordered.id} collate "C" desc`,
  ];
  const query = db
    .select({ id: ordered.id })
    .from(ordered)
    .orderBy(...terms)
    .$dynamic();
  const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;
  return rows.map((row) => row.id);
};

/** True when any leaf of `conditions` reads a lookup or a formula that reads one. */
export const conditionsReadLookups = (
  fields: ReadonlyArray<BaseFieldVO>,
  conditions: ReadonlyArray<ViewFilterConditionVO>,
): boolean => {
  const dynamicSlugs = lookupDependentFieldSlugs(fields);
  return collectLeaves(conditions).some((leaf) => {
    const field = resolveFilterField(fields, leaf);
    return field !== undefined && dynamicSlugs.has(field.slug);
  });
};
