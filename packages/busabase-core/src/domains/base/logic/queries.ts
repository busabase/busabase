import "server-only";

import { ORPCError } from "@orpc/server";
import {
  countRecordsInputSchema,
  groupRecordsInputSchema,
  listRecordsInputSchema,
  listRecordsPageInputSchema,
  type listRecordsValueFilterNodeSchema,
} from "busabase-contract/domains/base/contract/record-schemas";
import type { ViewConfigVO, ViewFilterVO } from "busabase-contract/types";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
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
  busabaseCommits,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
} from "../../../db/schema";
import { hydrateRecord, hydrateRecords } from "../../../logic/cr-lifecycle";
import { buildBaseVisibilityExists, buildNodeVisibilityExists } from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import {
  listInputSchema,
  recordFieldFilterInputSchema,
  recordFieldGetInputSchema,
} from "../../../logic/store";
import {
  normalizeViewConfig,
  toBaseVO,
  toFieldVO,
  toRecordLinkVO,
  toViewVO,
  VALUE_TEXT_INDEX_LIMIT,
} from "../../../logic/vo";
import {
  applyViewConfigToEvaluableRecords,
  applyViewConfigToRecords,
  DATE_RANGE_FIELD_TYPES,
  GROUPABLE_FIELD_TYPES,
  groupKeyForValue,
} from "../utils/view-records";

export { listInputSchema, recordFieldFilterInputSchema, recordFieldGetInputSchema };

export const listBases = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select({ base: busabaseBases, nodeMetadata: busabaseNodes.metadata })
    .from(busabaseBases)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
    .where(
      and(
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.archivedAt),
        buildNodeVisibilityExists(db, busabaseBases.nodeId),
      ),
    )
    .orderBy(asc(busabaseBases.createdAt));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.spaceId, spaceId), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return baseRows.map(({ base, nodeMetadata }) =>
    toBaseVO(
      base,
      fieldRows.filter((field) => field.baseId === base.id),
      nodeMetadata,
    ),
  );
};

export const getBase = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Slug resolution prefers the ACTIVE base: after slug reuse an archived base
  // and a new active base can share a slug, and navigating to /base/<slug>
  // must land on the live one. (The id fallback below stays unfiltered on
  // archivedAt so an archived-but-not-purged base is still reachable by id for
  // the restore / notice flows. Both the Base id and its owning Node id are
  // accepted so `/base/:ref` follows the same ID-or-slug rule as other node
  // routes. A permanently deleted Base is excluded:
  // once purged there is no restore flow left, so it must resolve to "not
  // found" like everything else that's been purged.)
  // Node ACL: a base whose node the actor can't see resolves to null here —
  // indistinguishable from a base that doesn't exist.
  const visible = buildNodeVisibilityExists(db, busabaseBases.nodeId);
  const [bySlug] = await db
    .select({ base: busabaseBases, nodeMetadata: busabaseNodes.metadata })
    .from(busabaseBases)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
    .where(
      and(
        eq(busabaseBases.slug, baseId),
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.archivedAt),
        visible,
      ),
    )
    .limit(1);
  const [row] = bySlug
    ? [bySlug]
    : await db
        .select({ base: busabaseBases, nodeMetadata: busabaseNodes.metadata })
        .from(busabaseBases)
        .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
        .where(
          and(
            or(eq(busabaseBases.id, baseId), eq(busabaseBases.nodeId, baseId)),
            eq(busabaseBases.spaceId, spaceId),
            isNull(busabaseBases.deletedAt),
            visible,
          ),
        )
        .limit(1);
  if (!row) {
    return null;
  }
  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, row.base.id), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return toBaseVO(row.base, fields, row.nodeMetadata);
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
            buildNodeVisibilityExists(db, busabaseBases.nodeId),
          ),
        )
        .orderBy(asc(busabaseViews.createdAt))
        .then((rows) => rows.map((r) => r.view));
  const users = await resolveUserRefs(viewRows.map((view) => view.createdBy));
  return viewRows.map((view) => toViewVO(view, users));
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

// ── Exact value filters ────────────────────────────────────────────────────
//
// A different contract from `buildPushableRecordFilter` above, and the
// difference is the whole point. That one answers "give me a superset cheaply",
// because its authority is the client's `recordMatchesViewFilter`, which
// compares rendered preview TEXT. This one answers "give me exactly these
// rows", by comparing the stored value in its own typed column.
//
// Being exact is what lets a caller push `limit` down alongside it. A superset
// filter can never carry a limit: the server's extra rows would eat the budget
// and the caller would get a short page it cannot distinguish from a complete
// one.
//
// Exactness here is not a proof obligation the way it is for the aggregates —
// it is structural. Each family below is admitted only because its stored
// column IS the value, with no formatting layer to diverge from (the reason a
// currency number's contains/equals is NOT exactly pushable).
//
// `created_time` / `updated_time` join `date`: they are computed at commit time
// but flow through the SAME projection as a plain date field once written (see
// `DATE_RANGE_FIELD_TYPES` in utils/view-records.ts, which has always included
// them for exactly this reason), so a predicate on `value_date` applies to them
// identically.
const EXACT_DATE_VALUE_TYPES = new Set(["date", "created_time", "updated_time"]);

// Checkbox compares `value_bool`. Note this is SQL semantics, not grid
// semantics, and they genuinely differ: `recordMatchesViewFilter` folds an
// UNSET checkbox in with `false`, while `eq(done, false)` here does not match a
// record that has no row for `done` at all — the `EXISTS` finds nothing. That
// is the correct answer for a value filter (SQL's NULL never equals FALSE) and
// it is what the caller's own local predicate computes, so the two agree.
const EXACT_BOOLEAN_VALUE_TYPES = new Set(["checkbox"]);

// Text-like families compare `value_text`, and ONLY for `eq`/`ne`.
//
// Truncation is not a problem for equality, which is worth spelling out because
// it looks like one. `value_text` stores the first VALUE_TEXT_INDEX_LIMIT
// characters. If the comparison value is SHORTER than that limit, then
// `value_text = $target` holds if and only if the full stored value equals the
// target: a truncated value has exactly VALUE_TEXT_INDEX_LIMIT characters, so
// it cannot equal a shorter target. A target at or over the limit is refused
// below rather than guessed at. `ne` inherits the same equivalence.
//
// ORDERING (`gt`/`lt`/…) is deliberately NOT admitted for text, and not because
// of truncation — the same argument would carry. It is collation: Postgres
// orders text by the database collation, the caller's local predicate orders it
// by JavaScript string comparison, and the two disagree (in en_US.UTF-8 `'a' <
// 'B'`; in JS `'B' < 'a'`). An "exact" filter whose row order the caller cannot
// reproduce is worse than no filter, so text ordering stays local.
//
// `select` is here even though it is absent from PUSHABLE_TEXT_TYPES above, and
// the difference is the point: that set is about VIEW filters, which compare a
// choice's rendered label. A value filter compares the stored choice string,
// which is exactly what the record payload hands the caller.
const EXACT_TEXT_VALUE_TYPES = new Set([...PUSHABLE_TEXT_TYPES, "select"]);
const EXACT_TEXT_OPERATORS = new Set(["eq", "ne"]);

/**
 * What `bucketing: "sql"` can group by, which is wider than the grid's set.
 *
 * `GROUPABLE_FIELD_TYPES` (select + checkbox) is narrow because GRID bucketing
 * groups on the truncatable text projection and buckets dates by the viewer's
 * day — neither of which the server can do correctly. SQL bucketing groups on
 * the raw stored column instead: `value_number` for numbers, `value_date` for
 * the exact instant (not a day), `value_bool` for a checkbox. Text stays out of
 * both, because two long values can collide at the projection limit.
 */
/** A bucket key is the stored value itself once SQL bucketing stops folding. */
type BucketKey = string | number | boolean | null;

const SQL_GROUPABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  ...GROUPABLE_FIELD_TYPES,
  ...PUSHABLE_NUMBER_TYPES,
  ...EXACT_DATE_VALUE_TYPES,
]);

const VALUE_FILTER_COMPARATORS = { eq, ne, gt, gte, lt, lte } as const;

/**
 * One value filter → SQL, or a 400 explaining why it cannot be exact.
 *
 * Refusing is the feature. Silently dropping a condition the way the superset
 * path does would return a superset while the caller believes it was filtered —
 * and, because this contract invites them to trust it with `limit`, they would
 * page through the wrong row set without any signal that it happened.
 *
 * The field's type is read from the Base's own definitions, never from a
 * caller-supplied hint: a lying hint here would produce confidently wrong rows,
 * whereas on the superset path it only ever costs a missed optimization.
 */
const buildExactValueFilter = (
  db: Awaited<ReturnType<typeof getDb>>,
  filter: { fieldSlug: string; operator: string; value: number | string | boolean },
  field: { slug: string; type: string } | undefined,
): SQL => {
  if (!field) {
    throw new ORPCError("BAD_REQUEST", {
      message: `valueFilters: this Base has no field "${filter.fieldSlug}"`,
    });
  }
  const compare =
    VALUE_FILTER_COMPARATORS[filter.operator as keyof typeof VALUE_FILTER_COMPARATORS];
  if (!compare) {
    throw new ORPCError("BAD_REQUEST", {
      message: `valueFilters: unsupported operator "${filter.operator}"`,
    });
  }

  let predicate: SQL;
  if (PUSHABLE_NUMBER_TYPES.has(field.type)) {
    const numeric = typeof filter.value === "number" ? filter.value : Number(filter.value);
    if (!Number.isFinite(numeric)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.fieldSlug}" is a number field, but ${JSON.stringify(filter.value)} is not a number`,
      });
    }
    predicate = compare(busabaseFieldValues.valueNumber, numeric) as SQL;
  } else if (EXACT_DATE_VALUE_TYPES.has(field.type)) {
    if (typeof filter.value === "boolean") {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.fieldSlug}" is a date field, but ${JSON.stringify(filter.value)} is not a valid date`,
      });
    }
    const date = new Date(filter.value);
    if (Number.isNaN(date.getTime())) {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.fieldSlug}" is a date field, but ${JSON.stringify(filter.value)} is not a valid date`,
      });
    }
    predicate = compare(busabaseFieldValues.valueDate, date) as SQL;
  } else if (EXACT_BOOLEAN_VALUE_TYPES.has(field.type)) {
    // `"true"` / `"false"` are accepted alongside real booleans because
    // `records.list` and `records.count` are GET routes: a query string has no
    // types, so a caller sending `true` gets a string on the wire and there is
    // no way for the schema to tell it apart from a text value. The number
    // branch above has the same problem and solves it the same way (`Number()`
    // on whatever arrives); without this, checkbox filters worked in-process
    // and 400'd over REST — including from the SDK, which is itself an
    // OpenAPI client.
    //
    // Only these two spellings, and only on a checkbox field. Anything else is
    // still refused, so a genuine mistake is not laundered into `false`.
    const asBoolean =
      typeof filter.value === "boolean"
        ? filter.value
        : filter.value === "true"
          ? true
          : filter.value === "false"
            ? false
            : null;
    if (asBoolean === null) {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.fieldSlug}" is a checkbox field, but ${JSON.stringify(filter.value)} is not a boolean`,
      });
    }
    if (!EXACT_TEXT_OPERATORS.has(filter.operator)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.operator}" is not meaningful on the checkbox field "${filter.fieldSlug}" — use eq or ne`,
      });
    }
    predicate = compare(busabaseFieldValues.valueBool, asBoolean) as SQL;
  } else if (EXACT_TEXT_VALUE_TYPES.has(field.type)) {
    if (typeof filter.value !== "string") {
      throw new ORPCError("BAD_REQUEST", {
        message: `valueFilters: "${filter.fieldSlug}" is a ${field.type} field, but ${JSON.stringify(filter.value)} is not a string`,
      });
    }
    if (!EXACT_TEXT_OPERATORS.has(filter.operator)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          `valueFilters: "${filter.operator}" is not exact on the text field "${filter.fieldSlug}". ` +
          `Postgres orders text by database collation and a client orders it by its own string comparison, ` +
          `so an ordering answer would not be reproducible. Only eq and ne are exact on text.`,
      });
    }
    // The equality proof above holds only while the target is shorter than the
    // projection limit. At or over it, a stored value truncated to exactly the
    // limit could equal the target while the full value differs — so refuse
    // rather than return a row set that is quietly wrong at the long tail.
    if (filter.value.length >= VALUE_TEXT_INDEX_LIMIT) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          `valueFilters: the comparison value for "${filter.fieldSlug}" is ${filter.value.length} characters, ` +
          `at or over the ${VALUE_TEXT_INDEX_LIMIT}-character projection limit, so an exact text match cannot be proven. ` +
          `Use \`filters\` for a best-effort match on values this long.`,
      });
    }
    predicate = compare(busabaseFieldValues.valueText, filter.value) as SQL;
  } else {
    throw new ORPCError("BAD_REQUEST", {
      message:
        `valueFilters: "${filter.fieldSlug}" is a ${field.type} field, which has no exact value column. ` +
        `Number, date, checkbox and text-like fields can be compared exactly; use \`filters\` for a best-effort match on the rest.`,
    });
  }

  // A record with no stored row for this field does not match — the same way
  // SQL's three-valued logic drops a NULL from every comparison, including the
  // negative ones (`ne` on an absent field is UNKNOWN, not true).
  return exists(
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
};

/**
 * One CNF conjunct → SQL: either a single comparison, or an OR of them.
 *
 * A disjunct is built with the same `buildExactValueFilter` as a bare
 * comparison, so an unpushable field inside an `any` raises exactly as it would
 * outside one. That matters more here than it looks: dropping a disjunct
 * silently would return a SUBSET (the dropped branch's rows go missing),
 * whereas dropping a conjunct only widens. Refusing both ways keeps the caller
 * from having to know which mistake it just made.
 */
const buildExactValueFilterNode = (
  db: Awaited<ReturnType<typeof getDb>>,
  node:
    | { fieldSlug: string; operator: string; value: number | string | boolean }
    | { any: { fieldSlug: string; operator: string; value: number | string | boolean }[] },
  fieldFor: (slug: string) => { slug: string; type: string } | undefined,
): SQL => {
  if ("any" in node) {
    const branches = node.any.map((leaf) =>
      buildExactValueFilter(db, leaf, fieldFor(leaf.fieldSlug)),
    );
    return (branches.length === 1 ? branches[0] : or(...branches)) as SQL;
  }
  return buildExactValueFilter(db, node, fieldFor(node.fieldSlug));
};

/**
 * `valueFilters` → SQL predicates, for any endpoint that takes them.
 *
 * Shared by list / count / groupBy because the exactness argument is what makes
 * them worth having on the aggregates at all: an ad-hoc view `filters` set that
 * cannot be PROVEN exact forces those endpoints to read every candidate row and
 * decide in memory, while these are exact by construction and stay a single SQL
 * aggregate. Two copies of this would be two chances for that property to drift.
 */
const buildValueFilterPredicates = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
  nodes: z.infer<typeof listRecordsValueFilterNodeSchema>[],
): Promise<SQL[]> => {
  const base = await getBase(baseId);
  if (!base) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${baseId}` });
  }
  const fieldFor = (slug: string) => base.fields.find((entry) => entry.slug === slug);
  return nodes.map((node) => buildExactValueFilterNode(db, node, fieldFor));
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
  const recordsVisible = buildBaseVisibilityExists(db, busabaseRecords.baseId);
  if (recordsVisible) {
    filters.push(recordsVisible);
  }
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
  // Exact value comparisons, ANDed on top. Unlike the superset filters above,
  // every one of these either becomes SQL or raises — so whatever survives here
  // makes the returned row set authoritative for the conditions given.
  if (parsed.valueFilters?.length) {
    if (!parsed.baseId) {
      throw new ORPCError("BAD_REQUEST", {
        message: "valueFilters requires baseId — a field slug only resolves within one Base",
      });
    }
    filters.push(...(await buildValueFilterPredicates(db, parsed.baseId, parsed.valueFilters)));
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
          // Do NOT add a base_id predicate here. It looks like it should help
          // (there is a (base_id, field_slug) index) but it makes the planner
          // choose that index for the inner scan and filter record_id
          // afterwards — 20,000 rows per outer record. Measured on a 10k Base:
          // 7.8s without it, 214s with it. The right access path is by
          // record_id, which busabase_field_values_record_field_idx serves
          // exactly; see the note on that index in domains/base/schema.ts.
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
 * Random-access pagination for Table/Gallery views. Saved-view filtering and
 * sorting is deliberately authoritative here: the complete visible candidate
 * set is hydrated first, then filtered/sorted, and only then sliced. This keeps
 * totals and every page correct for complex fields that cannot be expressed by
 * the field-value SQL projection yet.
 */
export const listRecordsPage = async (input: z.input<typeof listRecordsPageInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listRecordsPageInputSchema.parse(input);
  const base = await getBase(parsed.baseId);
  if (!base) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${parsed.baseId}` });
  }

  let viewConfig: ReturnType<typeof normalizeViewConfig> | undefined;
  if (parsed.viewId) {
    const [view] = await db
      .select()
      .from(busabaseViews)
      .where(
        and(
          eq(busabaseViews.id, parsed.viewId),
          eq(busabaseViews.baseId, base.id),
          eq(busabaseViews.spaceId, getContextSpaceId()),
          eq(busabaseViews.status, "active"),
        ),
      )
      .limit(1);
    if (!view) {
      throw new ORPCError("NOT_FOUND", { message: `View not found: ${parsed.viewId}` });
    }
    viewConfig = normalizeViewConfig(view.config);
  }

  const recordFilters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.baseId, base.id),
    eq(busabaseRecords.status, "active"),
  ];
  const pageVisible = buildBaseVisibilityExists(db, busabaseRecords.baseId);
  if (pageVisible) {
    recordFilters.push(pageVisible);
  }
  if (parsed.dateRange) {
    const rangeField = base.fields.find((field) => field.slug === parsed.dateRange?.fieldSlug);
    if (!rangeField) {
      throw new ORPCError("NOT_FOUND", {
        message: `Field not found in Base ${base.id}: ${parsed.dateRange.fieldSlug}`,
      });
    }
    if (!DATE_RANGE_FIELD_TYPES.has(rangeField.type)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot scope by a ${rangeField.type} field: ${rangeField.slug}. dateRange requires one of: ${[...DATE_RANGE_FIELD_TYPES].join(", ")}.`,
      });
    }
    const { gte: gteIso, lt: ltIso, fieldSlug } = parsed.dateRange;
    // A real UTC-instant comparison on the typed `valueDate` column — no
    // client-matcher parity question here, unlike `buildExactRecordFilter`'s
    // predicates. The caller resolved the viewer's timezone into these two
    // absolute instants already; the server only compares timestamps.
    recordFilters.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(busabaseFieldValues)
          .where(
            and(
              eq(busabaseFieldValues.recordId, busabaseRecords.id),
              eq(busabaseFieldValues.fieldSlug, fieldSlug),
              isNull(busabaseFieldValues.deletedAt),
              gte(busabaseFieldValues.valueDate, new Date(gteIso)),
              lt(busabaseFieldValues.valueDate, new Date(ltIso)),
            ),
          ),
      ) as SQL,
    );
  }
  // The View's own filters AND any ad-hoc ones (a board column's
  // `stackField equals <choice>`). Both are authoritative here — see the
  // `filters` doc on `listRecordsPageInputSchema` for why these are not the
  // superset semantics `records.list` uses.
  const effectiveViewConfig: ViewConfigVO | undefined =
    parsed.filters?.length || viewConfig
      ? {
          filters: [...(viewConfig?.filters ?? []), ...(parsed.filters ?? [])],
          sorts: viewConfig?.sorts ?? [],
        }
      : undefined;
  const needsExactViewEvaluation = Boolean(
    effectiveViewConfig &&
      (effectiveViewConfig.filters.length > 0 || effectiveViewConfig.sorts.length > 0),
  );

  // NOTE: there is deliberately no "all filters are pushable → SQL LIMIT/OFFSET"
  // fast path here, even though `resolveAggregateFilterScope` could prove it.
  // The exact-evaluation path below orders by the client's own comparator,
  // whose fallback is `updatedAt desc, id desc` (`compareRecordsByViewSort`),
  // while the SQL path below orders by `createdAt desc, id desc`. Serving some
  // pages from one ordering and some from the other would let a record repeat
  // on one page and vanish from another as the user pages through a column.
  // Unifying those two orderings is a separate change; until then, a filtered
  // page is always exact-evaluated.

  // The ordinary All view and presentation-only saved views can use true SQL
  // random access: count once, then hydrate only the requested page.
  if (!needsExactViewEvaluation) {
    const [countRow] = await db
      .select({ value: count() })
      .from(busabaseRecords)
      .where(and(...recordFilters));
    const total = countRow?.value ?? 0;
    const totalPages = Math.ceil(total / parsed.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(parsed.page, totalPages);
    const offset = (page - 1) * parsed.pageSize;
    const rows = await db
      .select()
      .from(busabaseRecords)
      .where(and(...recordFilters))
      .orderBy(desc(busabaseRecords.createdAt), desc(busabaseRecords.id))
      .limit(parsed.pageSize)
      .offset(offset);
    return {
      records: await hydrateRecords(rows),
      total,
      totalPages,
      page,
      pageSize: parsed.pageSize,
    };
  }

  // Complex saved views remain exact even when their field semantics cannot be
  // represented by the projection table: the whole visible Base is evaluated,
  // then only the requested slice is returned.
  //
  // The evaluation deliberately does NOT hydrate first. Filtering and sorting
  // read only a record's field values, its id and its updatedAt — so the
  // candidate set is read as `(id, updatedAt, commit.fields)` rows, and just the
  // ~pageSize records that survive into the page are hydrated into VOs. On a
  // 10k-record Base that is the difference between building 10,000 VOs (with
  // their bases, commits, users and lookups) and building 50.
  //
  // One exception keeps the old whole-Base path: a `lookup` field's value is not
  // in the commit — it is derived from other records at hydration time — so a
  // view that filters or sorts BY a lookup field can only be evaluated after
  // hydration. Rather than half-resolve it, that case falls through unchanged.
  const viewFieldSlugs = new Set([
    ...(effectiveViewConfig?.filters ?? []).map((filter) => filter.fieldSlug),
    ...(effectiveViewConfig?.sorts ?? []).map((sort) => sort.fieldSlug),
  ]);
  const dependsOnLookup = base.fields.some(
    (field) => field.type === "lookup" && viewFieldSlugs.has(field.slug),
  );

  if (!dependsOnLookup) {
    const candidateRows = await db
      .select({
        id: busabaseRecords.id,
        updatedAt: busabaseRecords.updatedAt,
        fields: busabaseCommits.payload,
      })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(and(...recordFilters))
      .orderBy(desc(busabaseRecords.createdAt), desc(busabaseRecords.id));
    const ordered = applyViewConfigToEvaluableRecords(
      candidateRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        fields: (row.fields ?? {}) as Record<string, unknown>,
      })),
      base.fields,
      effectiveViewConfig,
    );
    const total = ordered.length;
    const totalPages = Math.ceil(total / parsed.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(parsed.page, totalPages);
    const offset = (page - 1) * parsed.pageSize;
    const pageIds = ordered.slice(offset, offset + parsed.pageSize).map((row) => row.id);
    // Hydrate only the page, then restore the order the view decided (the
    // WHERE ... IN read comes back in whatever order the engine likes).
    const pageRecords = pageIds.length
      ? await hydrateRecords(
          await db.select().from(busabaseRecords).where(inArray(busabaseRecords.id, pageIds)),
        )
      : [];
    const byId = new Map(pageRecords.map((record) => [record.id, record]));
    return {
      records: pageIds.flatMap((recordId) => {
        const record = byId.get(recordId);
        return record ? [record] : [];
      }),
      total,
      totalPages,
      page,
      pageSize: parsed.pageSize,
    };
  }

  const candidateRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...recordFilters))
    .orderBy(desc(busabaseRecords.createdAt), desc(busabaseRecords.id));
  const candidates = await hydrateRecords(candidateRows);
  const ordered = applyViewConfigToRecords(candidates, effectiveViewConfig);
  const total = ordered.length;
  const totalPages = Math.ceil(total / parsed.pageSize);
  const page = totalPages === 0 ? 1 : Math.min(parsed.page, totalPages);
  const offset = (page - 1) * parsed.pageSize;

  return {
    records: ordered.slice(offset, offset + parsed.pageSize),
    total,
    totalPages,
    page,
    pageSize: parsed.pageSize,
  };
};

// ── Exact filter pushdown for records.count ────────────────────────────────
// `buildPushableRecordFilter` above is a SUPERSET pushdown: safe to over-match
// because `records.list`'s caller (the dashboard table) always re-narrows with
// its own client-side `applyViewConfigToRecords`. `records.count` has no
// client to narrow with — a wrong number would still render as an
// authoritative dashboard tile — so it needs a stricter question: "is this SQL
// predicate PROVEN identical to `recordMatchesViewFilter` (utils/view-records.ts),
// not just a safe superset?" Only pairs answered YES below get pushed to SQL;
// everything else falls back to the exact (but not free) evaluate-then-count
// path in `countRecords`.
//
// Crucially this is decided against the field's REAL type (looked up from the
// Base's field definitions), never the caller-supplied `listRecordsFilterSchema
// .fieldType` hint — that hint is only ever a pushdown *hint* elsewhere in this
// file (a lying caller only costs a missed optimization there); trusting it
// here would let a caller produce a confidently wrong count.

// Text types whose stored `valueText` projection is the untransformed raw
// value (see `normalizeFieldValue`), so it's byte-for-byte what
// `getViewFieldPreviewText` renders. `html` is excluded (the client preview
// strips tags; the projection doesn't) and so is `embed` (the client preview
// resolves an embed-specific label via `resolveEmbedPreview`, unrelated to the
// stored text) — pushing either down would silently diverge from the client's
// number.
const EXACT_TEXT_TYPES = new Set(["text", "longtext", "markdown", "url", "email", "phone", "code"]);

// Escapes LIKE/ILIKE metacharacters so a filter value containing a literal
// `%`, `_`, or `\` can't be misread as a wildcard. The superset pushdown above
// doesn't bother (over-matching is safe there); an exact count can't skip it.
const escapeLikePattern = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

// `contains` / `equals` compare `String(value)` against the stored text. That
// only provably matches `getViewFieldPreviewText`'s formatting for scalar
// values — an object/array filter value goes through `JSON.stringify(v, null,
// 2)` (pretty-printed) on the client side, which `String(v)` does not
// reproduce.
const isScalarFilterValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

// `contains`/`equals` compare against `valueText`, which `normalizeFieldValue`
// (logic/vo.ts) truncates at `VALUE_TEXT_INDEX_LIMIT` chars — but the
// authoritative client match (`recordMatchesViewFilter` → `getViewFieldPreviewText`
// → `fieldValueToString`) reads the FULL value from `commits.payload`. So a
// `longtext`/`markdown` field with any value at/over the limit can silently
// under-count on `contains`/`equals` (a match that only exists past the cutoff
// is invisible to SQL). `not_empty`/`is_empty` (presence) and the checkbox
// operators (booleanness) are untouched by truncation — only these two
// operators need the extra probe below.
const TRUNCATION_SENSITIVE_OPERATORS = new Set(["contains", "equals"]);

/**
 * True when Base `baseId`'s `fieldSlug` has at least one projected value at or
 * over `VALUE_TEXT_INDEX_LIMIT` — i.e. `valueText` may be truncated relative
 * to the field's real value for SOME record. Scoped by the
 * `busabase_field_values_base_field_idx` (baseId, fieldSlug) index, so this is
 * a narrow index lookup, not a table scan.
 */
const hasTruncatedFieldValue = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
  fieldSlug: string,
): Promise<boolean> => {
  const [row] = await db
    .select({ one: sql`1` })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.baseId, baseId),
        eq(busabaseFieldValues.fieldSlug, fieldSlug),
        isNull(busabaseFieldValues.deletedAt),
        sql`length(${busabaseFieldValues.valueText}) >= ${VALUE_TEXT_INDEX_LIMIT}`,
      ),
    )
    .limit(1);
  return Boolean(row);
};

/**
 * True when `buildExactRecordFilter` below can build a SQL predicate proven
 * identical to `recordMatchesViewFilter` for this (operator, real field type,
 * value) combination. Anything not enumerated here is NOT assumed exact — it
 * routes `countRecords` to the hydrate/evaluate fallback instead.
 *
 * NOTE: this alone is necessary but not SUFFICIENT for `contains`/`equals` on
 * a text type — `countRecords` additionally probes `hasTruncatedFieldValue`
 * for those two operators before trusting this "true", since truncation is a
 * per-field-data fact this (operator, type, value) triple can't see.
 */
type ExactFilterField = {
  type: string;
  options?: { choices?: Array<{ id: string; name: string }> };
};

const selectChoicesOf = (
  field: ExactFilterField | undefined,
): Array<{ id: string; name: string }> => field?.options?.choices ?? [];

/**
 * The label a `select` value renders as, lower-cased — mirroring `choiceLabel`
 * (utils/view-records.ts): a known choice id becomes its NAME, anything else
 * (a stale id, a value written past validation) falls back to the raw string.
 */
const selectLabelOf = (field: ExactFilterField | undefined, value: unknown): string => {
  const id = typeof value === "string" ? value : "";
  return (selectChoicesOf(field).find((choice) => choice.id === id)?.name ?? id).toLowerCase();
};

/** A choice whose name renders as "empty" to `recordMatchesViewFilter`. */
const isBlankLabel = (name: string): boolean => name === "" || name === "-";

const isFilterExactlyPushable = (
  operator: string,
  field: ExactFilterField | undefined,
  value: unknown,
): boolean => {
  const type = field?.type ?? "";
  if (EXACT_TEXT_TYPES.has(type)) {
    if (operator === "not_empty" || operator === "is_empty") return true;
    if (operator === "contains" || operator === "equals") return isScalarFilterValue(value);
    return false;
  }
  if (PUSHABLE_NUMBER_TYPES.has(type)) {
    // contains/equals are excluded: a currency-formatted number's preview
    // text ("$1,234.00") differs from the raw valueText ("1234"), and whether
    // the field IS currency-formatted lives in `options.number.format`, which
    // this (operator, type) pair alone can't see. Presence/absence, though,
    // is format-independent — not_empty/is_empty stay provably exact.
    return operator === "not_empty" || operator === "is_empty";
  }
  if (type === "checkbox") {
    return operator === "is_true" || operator === "is_false";
  }
  if (type === "select") {
    if (operator === "not_empty" || operator === "is_empty") return true;
    if (operator !== "equals" && operator !== "contains") return false;
    if (!isScalarFilterValue(value)) return false;
    // An empty expected label would also match every record that has NO value
    // for this field (their preview text is ""), and the EXISTS-based predicate
    // below can only see records that HAVE a projected row. Rather than bolt on
    // an absence join, leave that case to the exact fallback.
    return selectLabelOf(field, value) !== "";
  }
  return false;
};

/** Only call once `isFilterExactlyPushable` returned true for the same triple. */
const buildExactRecordFilter = (
  db: Awaited<ReturnType<typeof getDb>>,
  filter: { fieldSlug: string; operator: string; value?: unknown },
  field: ExactFilterField | undefined,
): SQL => {
  const type = field?.type ?? "";
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
  const notMatches = (predicate: SQL): SQL => not(matches(predicate));
  // `recordMatchesViewFilter`'s not_empty/is_empty treats a preview text of
  // "-" as empty too (a placeholder some cell renderers use), regardless of
  // field type — mirrored here so the SQL predicate can't diverge on that one
  // literal value.
  const isPresent = and(
    isNotNull(busabaseFieldValues.valueText),
    ne(busabaseFieldValues.valueText, ""),
    ne(busabaseFieldValues.valueText, "-"),
  ) as SQL;

  if (EXACT_TEXT_TYPES.has(type)) {
    if (filter.operator === "contains") {
      return matches(
        ilike(busabaseFieldValues.valueText, `%${escapeLikePattern(String(filter.value ?? ""))}%`),
      );
    }
    if (filter.operator === "equals") {
      return matches(
        ilike(busabaseFieldValues.valueText, escapeLikePattern(String(filter.value ?? ""))),
      );
    }
    if (filter.operator === "not_empty") {
      return matches(isPresent);
    }
    return notMatches(isPresent); // is_empty
  }
  if (PUSHABLE_NUMBER_TYPES.has(type)) {
    return filter.operator === "not_empty" ? matches(isPresent) : notMatches(isPresent);
  }
  if (type === "select") {
    // `valueText` holds the choice ID; the client compares choice NAMES. So the
    // matching ids are resolved here, from the Base's own choice list, and the
    // SQL only ever matches ids. The second arm of each OR covers a value that
    // is NOT a known choice id (a stale id, or a value written past field
    // validation) — `choiceLabel` renders those as the raw string, so the
    // predicate applies to `valueText` directly, exactly as the client would.
    const choices = selectChoicesOf(field);
    const knownIds = choices.map((choice) => choice.id);
    const unknownId: SQL = knownIds.length
      ? (not(inArray(busabaseFieldValues.valueText, knownIds)) as SQL)
      : sql`true`;
    const idIn = (ids: string[]): SQL =>
      ids.length ? (inArray(busabaseFieldValues.valueText, ids) as SQL) : sql`false`;

    if (filter.operator === "not_empty" || filter.operator === "is_empty") {
      // Present ⟺ the rendered label is neither "" nor the "-" placeholder. A
      // choice may itself be named "-" (a legitimate "N/A" option), in which
      // case picking it still reads as EMPTY to the client.
      const labelledPresent = or(
        idIn(choices.filter((choice) => !isBlankLabel(choice.name)).map((choice) => choice.id)),
        and(unknownId, isPresent),
      ) as SQL;
      return filter.operator === "not_empty"
        ? matches(labelledPresent)
        : notMatches(labelledPresent);
    }

    const expected = selectLabelOf(field, filter.value); // already lower-cased
    const nameMatches = (name: string): boolean =>
      filter.operator === "equals"
        ? name.toLowerCase() === expected
        : name.toLowerCase().includes(expected);
    const rawMatches =
      filter.operator === "equals"
        ? ilike(busabaseFieldValues.valueText, escapeLikePattern(expected))
        : ilike(busabaseFieldValues.valueText, `%${escapeLikePattern(expected)}%`);
    return matches(
      or(
        idIn(choices.filter((choice) => nameMatches(choice.name)).map((choice) => choice.id)),
        and(unknownId, rawMatches),
      ) as SQL,
    );
  }
  // checkbox. `valueText` mirrors both the real-boolean and the string
  // "true"/"false" write shapes (see `normalizeFieldValue`), so a plain text
  // comparison is exact without touching `valueBool` (which a string-typed
  // "true" write never populates).
  if (filter.operator === "is_true") {
    return matches(eq(busabaseFieldValues.valueText, "true"));
  }
  // is_false: `recordMatchesViewFilter` treats false/"false"/null/undefined as
  // false, and nothing else (a garbage value like 42 or "banana" is neither
  // is_true nor is_false). So is_false ⟺ "no row proves this field is
  // anything other than false" — which also covers a field that was never set
  // (no row at all, so the inner NOT EXISTS is vacuously true).
  return notMatches(
    and(
      isNotNull(busabaseFieldValues.valueText),
      ne(busabaseFieldValues.valueText, "false"),
    ) as SQL,
  );
};

/**
 * Shared scope resolution for the exactness-sensitive aggregates
 * (`countRecords`, `groupRecords`). Both publish a number a dashboard renders
 * as authoritative, so both need the same question answered: can this
 * (View filters + ad-hoc filters) set become a SQL predicate PROVEN identical
 * to `recordMatchesViewFilter`, or must the caller evaluate every row instead?
 *
 * `exactPredicates` is the SQL to AND into the aggregate when that proof
 * holds, and `null` when it doesn't — the caller then takes its own exact-but-
 * not-free fallback path. An empty array means "no filters at all", which is
 * trivially exact.
 */
const resolveAggregateFilterScope = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
  viewId: string | undefined,
  adHocFilters: ViewFilterVO[] | undefined,
) => {
  const base = await getBase(baseId);
  if (!base) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${baseId}` });
  }

  let viewFilters: ViewFilterVO[] = [];
  if (viewId) {
    const [view] = await db
      .select()
      .from(busabaseViews)
      .where(
        and(
          eq(busabaseViews.id, viewId),
          eq(busabaseViews.baseId, base.id),
          eq(busabaseViews.spaceId, getContextSpaceId()),
          eq(busabaseViews.status, "active"),
        ),
      )
      .limit(1);
    if (!view) {
      throw new ORPCError("NOT_FOUND", { message: `View not found: ${viewId}` });
    }
    viewFilters = normalizeViewConfig(view.config).filters;
  }
  // View filters AND ad-hoc filters when both are given — "this View, further
  // narrowed by these extra conditions" is the only reading that makes sense
  // for a dashboard tile built on top of a saved View.
  const allFilters: ViewFilterVO[] = [...viewFilters, ...(adHocFilters ?? [])];
  if (allFilters.length === 0) {
    return { base, allFilters, exactPredicates: [] as SQL[], dependsOnLookup: false };
  }

  const resolved = allFilters.map((filter) => ({
    filter,
    // The whole field, not just its type: proving a `select` filter exact
    // requires that field's own choice list (a label predicate has to be
    // resolved into the set of choice ids that produce it).
    field: base.fields.find((entry) => entry.slug === filter.fieldSlug),
  }));
  // A `lookup` field's value is computed at hydration time from other records,
  // not stored in the commit — so a filter on one can only be evaluated after
  // hydration, same constraint `listRecordsPage` has.
  const dependsOnLookup = resolved.some((entry) => entry.field?.type === "lookup");

  // Truncation probe: for the (fieldSlug) set behind a contains/equals filter
  // on a text type, check once each whether ANY stored value for that field in
  // this Base is at/over VALUE_TEXT_INDEX_LIMIT — narrow index lookups
  // (base_id, field_slug), not a scan. A truncated field can't trust the SQL
  // contains/equals predicate (see `hasTruncatedFieldValue`), so it forces that
  // filter — and therefore the whole aggregate — to the exact fallback.
  const truncationProbeSlugs = new Set(
    resolved
      .filter(
        (entry) =>
          TRUNCATION_SENSITIVE_OPERATORS.has(entry.filter.operator) &&
          EXACT_TEXT_TYPES.has(entry.field?.type ?? ""),
      )
      .map((entry) => entry.filter.fieldSlug),
  );
  const truncatedSlugs = new Set(
    (
      await Promise.all(
        [...truncationProbeSlugs].map(async (fieldSlug) => ({
          fieldSlug,
          truncated: await hasTruncatedFieldValue(db, base.id, fieldSlug),
        })),
      )
    )
      .filter((entry) => entry.truncated)
      .map((entry) => entry.fieldSlug),
  );

  const allExact =
    !dependsOnLookup &&
    resolved.every((entry) => {
      if (!isFilterExactlyPushable(entry.filter.operator, entry.field, entry.filter.value)) {
        return false;
      }
      if (
        TRUNCATION_SENSITIVE_OPERATORS.has(entry.filter.operator) &&
        truncatedSlugs.has(entry.filter.fieldSlug)
      ) {
        return false;
      }
      return true;
    });

  return {
    base,
    allFilters,
    dependsOnLookup,
    exactPredicates: allExact
      ? resolved.map((entry) => buildExactRecordFilter(db, entry.filter, entry.field))
      : null,
  };
};

/**
 * Count active records in the current space, a Base, a saved View, an ad-hoc
 * filter set, or a combination. Feeds "N of total" table headers and AirApp
 * summary tiles — the number MUST be exact (never a superset/partial count).
 *
 * Provably-exact filters (see `isFilterExactlyPushable`) get pushed to a real
 * SQL COUNT — with one extra guard: a `contains`/`equals` text filter also
 * gets probed with `hasTruncatedFieldValue`, since `valueText` is truncated at
 * `VALUE_TEXT_INDEX_LIMIT` while the client's authoritative match reads the
 * full value, so a truncated field can't trust the SQL predicate. Anything
 * else falls back to evaluating every visible candidate row with the same
 * `applyViewConfigToRecords`/`applyViewConfigToEvaluableRecords` used by
 * `listRecordsPage`'s exact-view path — still exact, just not free on a large
 * Base.
 */
export const countRecords = async (input?: z.input<typeof countRecordsInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = countRecordsInputSchema.parse(input);

  const baseFilters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.status, "active"),
  ];
  const countVisible = buildBaseVisibilityExists(db, busabaseRecords.baseId);
  if (countVisible) {
    baseFilters.push(countVisible);
  }
  if (parsed.baseId) {
    baseFilters.push(eq(busabaseRecords.baseId, parsed.baseId));
  }
  // Pushed into the BASE filters, not into the exact-path predicates, so every
  // route below inherits them — the fast SQL count, the proven-exact count, and
  // both in-memory fallbacks. The fallbacks only know about `allFilters`, so a
  // value filter left out here would be silently dropped on those paths.
  //
  // They are also exact by construction, so unlike an ad-hoc view `filters` set
  // they never push a count off its single-`count(*)` fast path. Resolving them
  // does resolve the Base, so a count carrying valueFilters against an unknown
  // baseId now 404s where a bare one still returns 0 (the pre-existing
  // contract for the unscoped case is untouched).
  if (parsed.valueFilters?.length) {
    baseFilters.push(
      ...(await buildValueFilterPredicates(db, parsed.baseId as string, parsed.valueFilters)),
    );
  }

  const sqlCount = async (extra: SQL[] = []) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(busabaseRecords)
      .where(and(...baseFilters, ...extra));
    return { total: row?.count ?? 0 };
  };

  // Fast path: unchanged from before viewId/filters existed on this endpoint.
  // An unscoped or bare-baseId count never resolves the Base, so an unknown
  // baseId returns 0 rather than 404 — the pre-existing contract.
  if (!parsed.viewId && !parsed.filters?.length) {
    return sqlCount();
  }

  // viewId/filters both require baseId (schema-enforced), so the Base — and
  // its real field definitions, which exactness depends on — is always
  // resolvable from here on.
  const { base, allFilters, dependsOnLookup, exactPredicates } = await resolveAggregateFilterScope(
    db,
    parsed.baseId as string,
    parsed.viewId,
    parsed.filters,
  );

  if (exactPredicates) {
    // Includes the "viewId pointed at a view with no filters" case, where the
    // predicate list is empty and this is a plain SQL COUNT.
    return sqlCount(exactPredicates);
  }

  // Fallback: exact, not cheap. At least one filter's server/client parity
  // couldn't be proven, or depends on a lookup field — evaluate every visible
  // candidate row the same way `listRecordsPage`'s exact-view path does, then
  // count the survivors.
  const viewConfigForFallback: ViewConfigVO = { filters: allFilters, sorts: [] };
  if (!dependsOnLookup) {
    const candidateRows = await db
      .select({
        id: busabaseRecords.id,
        updatedAt: busabaseRecords.updatedAt,
        fields: busabaseCommits.payload,
      })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(and(...baseFilters));
    const matched = applyViewConfigToEvaluableRecords(
      candidateRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        fields: (row.fields ?? {}) as Record<string, unknown>,
      })),
      base.fields,
      viewConfigForFallback,
    );
    return { total: matched.length };
  }

  const candidateRecordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...baseFilters));
  const candidates = await hydrateRecords(candidateRecordRows);
  const matched = applyViewConfigToRecords(candidates, viewConfigForFallback);
  return { total: matched.length };
};

/**
 * Count active records per group for one `select` or `checkbox` field — the
 * split a Kanban column header or a summary tile needs, WITHOUT reading the
 * records themselves. Scoped like `countRecords` (Base, optional saved View,
 * optional ad-hoc filters) and held to the same exactness bar: provably-exact
 * filters stay a single SQL aggregate, anything else falls back to evaluating
 * every candidate row and grouping in memory.
 *
 * Groups with zero records are omitted — the Base's field definition already
 * lists every choice, so the client knows which buckets to render empty.
 */
export const groupRecords = async (input: z.input<typeof groupRecordsInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = groupRecordsInputSchema.parse(input);

  const { base, allFilters, dependsOnLookup, exactPredicates } = await resolveAggregateFilterScope(
    db,
    parsed.baseId,
    parsed.viewId,
    parsed.filters,
  );

  // No `fieldSlug` means one bucket over the whole filtered set — the shape a
  // summary tile wants, and the reason `aggregates` is worth having at all.
  const groupSlug = parsed.fieldSlug;
  const sqlBuckets = parsed.bucketing === "sql";
  // SQL bucketing widens what can be grouped, and the reason is the same one
  // that narrowed it: `GROUPABLE_FIELD_TYPES` excludes number and date because
  // GRID bucketing groups on the truncatable text projection and buckets dates
  // by the viewer's day. Grouping on `value_number` / `value_date` — the raw
  // stored instant, not a day — has neither problem. Text stays out either way:
  // two long values can collide at the projection limit.
  const groupable = sqlBuckets ? SQL_GROUPABLE_FIELD_TYPES : GROUPABLE_FIELD_TYPES;
  const field = groupSlug ? base.fields.find((entry) => entry.slug === groupSlug) : undefined;
  if (groupSlug) {
    if (!field) {
      throw new ORPCError("NOT_FOUND", {
        message: `Field not found in Base ${parsed.baseId}: ${groupSlug}`,
      });
    }
    if (!groupable.has(field.type)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot group by a ${field.type} field: ${groupSlug}. Groupable types (bucketing: ${parsed.bucketing}): ${[...groupable].join(", ")}.`,
      });
    }
  }

  /** The column a group key is read from, which is what makes SQL bucketing exact. */
  const groupColumn = ():
    | typeof busabaseFieldValues.valueText
    | typeof busabaseFieldValues.valueNumber
    | typeof busabaseFieldValues.valueBool
    | typeof busabaseFieldValues.valueDate => {
    if (!sqlBuckets) return busabaseFieldValues.valueText;
    const type = field?.type ?? "";
    if (PUSHABLE_NUMBER_TYPES.has(type)) return busabaseFieldValues.valueNumber;
    if (EXACT_DATE_VALUE_TYPES.has(type)) return busabaseFieldValues.valueDate;
    if (EXACT_BOOLEAN_VALUE_TYPES.has(type)) return busabaseFieldValues.valueBool;
    return busabaseFieldValues.valueText;
  };

  /**
   * Raw stored value → bucket key.
   *
   * Grid bucketing folds (an unset checkbox into `false`, an empty string into
   * the null bucket); SQL bucketing does not fold anything, because `GROUP BY`
   * gives a missing value its own group. The two disagree on real data, which
   * is the whole reason `bucketing` is a choice.
   */
  const bucketKeyFor = (value: unknown): BucketKey => {
    if (!sqlBuckets) return groupKeyForValue(value, field?.type ?? "");
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return value as string | number | boolean;
  };

  const baseFilters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.baseId, base.id),
    eq(busabaseRecords.status, "active"),
  ];
  const groupVisible = buildBaseVisibilityExists(db, busabaseRecords.baseId);
  if (groupVisible) {
    baseFilters.push(groupVisible);
  }
  // Exact by construction, so they cost nothing on the fast path — and they are
  // added to `baseFilters` rather than to `exactPredicates` so BOTH paths honour
  // them. The in-memory fallback only knows about `allFilters`, so a value
  // filter left out of the SQL would be silently dropped there.
  if (parsed.valueFilters?.length) {
    baseFilters.push(...(await buildValueFilterPredicates(db, parsed.baseId, parsed.valueFilters)));
  }

  // Aggregates read `value_number`, so they are exact for the same reason
  // `valueFilters` are — the column holds the value itself. A field with no such
  // column is refused rather than summed as zero, which would be a confident
  // wrong total.
  const aggregates = parsed.aggregates ?? [];
  for (const aggregate of aggregates) {
    const target = base.fields.find((entry) => entry.slug === aggregate.fieldSlug);
    if (!target) {
      throw new ORPCError("NOT_FOUND", {
        message: `Field not found in Base ${parsed.baseId}: ${aggregate.fieldSlug}`,
      });
    }
    if (!PUSHABLE_NUMBER_TYPES.has(target.type)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          `Cannot ${aggregate.fn} a ${target.type} field: ${aggregate.fieldSlug}. ` +
          `Aggregates need a numeric value column; only ${[...PUSHABLE_NUMBER_TYPES].join(", ")} have one.`,
      });
    }
  }
  const aggregateKey = (aggregate: { fn: string; fieldSlug: string }) =>
    `${aggregate.fn}:${aggregate.fieldSlug}`;
  /** Aggregate slug → the index of its projected column in the keyed subquery. */
  const aggregateFieldSlugs = [...new Set(aggregates.map((entry) => entry.fieldSlug))];

  /** Compute the aggregates for one group's raw numeric values, in memory. */
  const aggregateOver = (
    valuesBySlug: Map<string, number[]>,
  ): Record<string, number | null> | undefined => {
    if (aggregates.length === 0) return undefined;
    const result: Record<string, number | null> = {};
    for (const aggregate of aggregates) {
      const values = valuesBySlug.get(aggregate.fieldSlug) ?? [];
      if (aggregate.fn === "count") {
        result[aggregateKey(aggregate)] = values.length;
        continue;
      }
      if (values.length === 0) {
        // NULL, not 0 — "no rows with a value" and "rows summing to zero" are
        // different answers, and SQL's aggregates distinguish them.
        result[aggregateKey(aggregate)] = null;
        continue;
      }
      const total = values.reduce((sum, value) => sum + value, 0);
      result[aggregateKey(aggregate)] =
        aggregate.fn === "sum"
          ? total
          : aggregate.fn === "avg"
            ? total / values.length
            : aggregate.fn === "min"
              ? Math.min(...values)
              : Math.max(...values);
    }
    return result;
  };

  const toResponse = (
    counts: Map<BucketKey, number>,
    perGroup?: Map<BucketKey, Record<string, number | null> | undefined>,
  ) => {
    const groups = [...counts.entries()]
      .map(([value, count]) => ({
        value,
        count,
        ...(perGroup?.get(value) ? { aggregates: perGroup.get(value) } : {}),
      }))
      // Stable output: named buckets by key, the null bucket last. Keys are no
      // longer only strings under SQL bucketing, so they compare by their own
      // type rather than lexically — otherwise 10 would sort before 9.
      .sort((left, right) => {
        if (left.value === right.value) return 0;
        if (left.value === null) return 1;
        if (right.value === null) return -1;
        if (typeof left.value === "number" && typeof right.value === "number") {
          return left.value - right.value;
        }
        return String(left.value) < String(right.value) ? -1 : 1;
      });
    return { groups, total: groups.reduce((sum, group) => sum + group.count, 0) };
  };

  if (exactPredicates) {
    // The group key is read as a scalar SUBQUERY rather than a JOIN on
    // busabase_field_values: that table has no unique index on
    // (record_id, field_slug) — uniqueness is maintained by the projection's
    // delete-then-insert (see logic/field-values.ts) — so a JOIN would
    // double-count any record that ever ends up with a duplicate row. A
    // subquery makes every record contribute exactly once no matter what,
    // which is the same guarantee `buildExactRecordFilter`'s EXISTS gives.
    //
    // It has to be a two-level query: Postgres rejects grouping BY a
    // correlated subquery directly ("subquery uses ungrouped column ... from
    // outer query"), so the inner select resolves one key per record and the
    // outer one aggregates those keys.
    //
    // Each AGGREGATE field gets its own scalar subquery in that inner select,
    // for the same reason the group key does.
    const scalarValue = (
      slug: string,
      column:
        | typeof busabaseFieldValues.valueText
        | typeof busabaseFieldValues.valueNumber
        | typeof busabaseFieldValues.valueBool
        | typeof busabaseFieldValues.valueDate,
    ) =>
      sql`(${db
        .select({ value: column })
        .from(busabaseFieldValues)
        .where(
          and(
            eq(busabaseFieldValues.recordId, busabaseRecords.id),
            eq(busabaseFieldValues.fieldSlug, slug),
            isNull(busabaseFieldValues.deletedAt),
          ),
        )
        .limit(1)})`;

    const innerSelection: Record<string, SQL.Aliased> = {
      groupKey: (groupSlug ? scalarValue(groupSlug, groupColumn()) : sql`null`) as SQL<
        string | null
      >,
    } as never;
    innerSelection.groupKey = (
      groupSlug ? scalarValue(groupSlug, groupColumn()) : sql`null::text`
    ).as("group_key") as SQL.Aliased;
    aggregateFieldSlugs.forEach((slug, index) => {
      innerSelection[`agg${index}`] = scalarValue(
        slug,
        busabaseFieldValues.valueNumber as never,
      ).as(`agg${index}`) as SQL.Aliased;
    });

    const keyed = db
      .select(innerSelection as never)
      .from(busabaseRecords)
      .where(and(...baseFilters, ...exactPredicates))
      .as("keyed_records");

    const outerSelection: Record<string, SQL> = {
      value: sql<string | null>`${sql.identifier("keyed_records")}.${sql.identifier("group_key")}`,
      count: sql<number>`count(*)::int`,
    };
    for (const aggregate of aggregates) {
      const index = aggregateFieldSlugs.indexOf(aggregate.fieldSlug);
      const column = sql`${sql.identifier("keyed_records")}.${sql.identifier(`agg${index}`)}`;
      outerSelection[aggregateKey(aggregate)] =
        aggregate.fn === "count"
          ? sql<number>`count(${column})::int`
          : sql<number | null>`${sql.raw(aggregate.fn)}(${column})::double precision`;
    }

    const rows = (await db
      .select(outerSelection as never)
      .from(keyed)
      .groupBy(
        sql`${sql.identifier("keyed_records")}.${sql.identifier("group_key")}`,
      )) as unknown as Record<string, unknown>[];

    const counts = new Map<BucketKey, number>();
    const perGroup = new Map<BucketKey, Record<string, number | null> | undefined>();
    for (const row of rows) {
      const key = bucketKeyFor(row.value);
      counts.set(key, (counts.get(key) ?? 0) + Number(row.count));
      if (aggregates.length) {
        const bucket: Record<string, number | null> = {};
        for (const aggregate of aggregates) {
          const raw = row[aggregateKey(aggregate)];
          bucket[aggregateKey(aggregate)] = raw === null || raw === undefined ? null : Number(raw);
        }
        perGroup.set(key, bucket);
      }
    }
    return toResponse(counts, aggregates.length ? perGroup : undefined);
  }

  // Fallback: exact, not cheap — same shape as `countRecords`'s. Evaluate every
  // candidate row, then group the survivors by their raw commit value.
  const viewConfigForFallback: ViewConfigVO = { filters: allFilters, sorts: [] };
  const countsFromRecords = (records: Array<{ fields: Record<string, unknown> }>) => {
    const counts = new Map<BucketKey, number>();
    // Aggregates are computed here too, from the same matched rows — leaving
    // them to the SQL path only would return counts-with-no-aggregates whenever
    // a filter could not be proven exact, which reads as "no data" rather than
    // as "this query took the slow path".
    const values = new Map<BucketKey, Map<string, number[]>>();
    for (const record of records) {
      const key = groupSlug ? bucketKeyFor(record.fields[groupSlug]) : null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!aggregates.length) continue;
      const bucket = values.get(key) ?? new Map<string, number[]>();
      for (const slug of aggregateFieldSlugs) {
        const raw = record.fields[slug];
        const numeric = typeof raw === "number" ? raw : Number(raw);
        if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(numeric)) {
          bucket.set(slug, [...(bucket.get(slug) ?? []), numeric]);
        }
      }
      values.set(key, bucket);
    }
    const perGroup = new Map<BucketKey, Record<string, number | null> | undefined>();
    for (const key of counts.keys()) {
      perGroup.set(key, aggregateOver(values.get(key) ?? new Map()));
    }
    return { counts, perGroup };
  };

  if (!dependsOnLookup) {
    const candidateRows = await db
      .select({
        id: busabaseRecords.id,
        updatedAt: busabaseRecords.updatedAt,
        fields: busabaseCommits.payload,
      })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(and(...baseFilters));
    const matched = applyViewConfigToEvaluableRecords(
      candidateRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        fields: (row.fields ?? {}) as Record<string, unknown>,
      })),
      base.fields,
      viewConfigForFallback,
    );
    const built = countsFromRecords(matched);
    return toResponse(built.counts, aggregates.length ? built.perGroup : undefined);
  }

  const candidateRecordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...baseFilters));
  const candidates = await hydrateRecords(candidateRecordRows);
  const matched = applyViewConfigToRecords(candidates, viewConfigForFallback);
  const built = countsFromRecords(matched.map((record) => ({ fields: record.headCommit.payload })));
  return toResponse(built.counts, aggregates.length ? built.perGroup : undefined);
};

export const getRecord = async (recordId: string) => {
  await ensureReady();
  const db = await getDb();
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(
        eq(busabaseRecords.id, recordId),
        eq(busabaseRecords.spaceId, getContextSpaceId()),
        buildBaseVisibilityExists(db, busabaseRecords.baseId),
      ),
    )
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
        // Gate on the SOURCE base's node visibility (links hang off a source
        // record); a link whose target base is private still shows only the
        // target record id — following it hits getRecord's own gate.
        buildBaseVisibilityExists(db, busabaseRecordLinks.baseId),
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
  const fieldTextVisible = buildBaseVisibilityExists(db, busabaseFieldValues.baseId);
  if (fieldTextVisible) {
    filters.push(fieldTextVisible);
  }
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

/**
 * Point lookup by an exact field value, scoped to one Base — the "get" counterpart to
 * `listRecordsByFieldText`'s "search" (which returns a list, and defaults baseId to
 * optional for cross-Base fan-out). Callers with a unique key per Base (a slug, a path)
 * should use this instead of listing then finding client-side.
 */
export const getRecordByField = async (input: z.input<typeof recordFieldGetInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = recordFieldGetInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseFieldValues.spaceId, getContextSpaceId()),
    eq(busabaseFieldValues.baseId, parsed.baseId),
    eq(busabaseFieldValues.fieldSlug, parsed.fieldSlug),
    eq(busabaseFieldValues.valueText, parsed.valueText),
    isNotNull(busabaseFieldValues.recordId),
    isNull(busabaseFieldValues.deletedAt),
  ];
  const fieldTextVisible = buildBaseVisibilityExists(db, busabaseFieldValues.baseId);
  if (fieldTextVisible) {
    filters.push(fieldTextVisible);
  }

  const [projectionRow] = await db
    .select()
    .from(busabaseFieldValues)
    .where(and(...filters))
    .orderBy(desc(busabaseFieldValues.createdAt))
    .limit(1);
  if (!projectionRow?.recordId) return null;

  return getRecord(projectionRow.recordId);
};

export const listArchivedBases = async () => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select({ base: busabaseBases, nodeMetadata: busabaseNodes.metadata })
    .from(busabaseBases)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseBases.nodeId))
    .where(
      and(
        eq(busabaseBases.spaceId, spaceId),
        isNotNull(busabaseBases.archivedAt),
        // Permanently-deleted bases leave the Trash for good — they're excluded
        // here the same way a purged folder/doc/skill leaves listArchivedNodes.
        isNull(busabaseBases.deletedAt),
        buildNodeVisibilityExists(db, busabaseBases.nodeId),
      ),
    )
    .orderBy(asc(busabaseBases.createdAt));
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.spaceId, spaceId), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return baseRows.map(({ base, nodeMetadata }) =>
    toBaseVO(
      base,
      fieldRows.filter((field) => field.baseId === base.id),
      nodeMetadata,
    ),
  );
};

/**
 * The active (non-deleted) field with the lowest `position` for a base — the
 * "who is the record title" rule evaluated at the db layer (no VO available
 * yet at merge time). MUST stay semantically equivalent to `getPrimaryField()`
 * in `../utils/primary-field.ts` (same "lowest position, first-inserted wins
 * ties" rule) — keep the two in sync if that rule ever changes.
 */
export const getPrimaryFieldIdFromDb = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseId: string,
): Promise<string | null> => {
  const [primaryField] = await db
    .select({ id: busabaseBaseFields.id })
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position))
    .limit(1);
  return primaryField?.id ?? null;
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

// Keyset-paginated archived records — same (createdAt, id) cursor as the active
// table, so the "trash" section never loads the whole soft-deleted history.
/** The `status: "archived"` branch of `records.list`. `baseId` is optional here
 *  for the same reason it is on the active listing: omitting it means the whole
 *  space, not an error. */
export const listArchivedRecordsPaged = async (input?: z.input<typeof listRecordsInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listRecordsInputSchema.parse(input);
  const filters: SQL[] = [
    eq(busabaseRecords.spaceId, getContextSpaceId()),
    eq(busabaseRecords.status, "archived"),
  ];
  if (parsed.baseId) {
    const resolvedBase = await getBase(parsed.baseId);
    if (!resolvedBase) {
      return { records: [], nextCursor: null };
    }
    filters.push(eq(busabaseRecords.baseId, resolvedBase.id));
  }
  const archivedVisible = buildBaseVisibilityExists(db, busabaseRecords.baseId);
  if (archivedVisible) {
    filters.push(archivedVisible);
  }
  if (parsed.cursor) {
    const decoded = decodeRecordCursor(parsed.cursor);
    if (decoded) {
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
