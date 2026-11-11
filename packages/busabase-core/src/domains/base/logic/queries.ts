import "server-only";

import { ORPCError } from "@orpc/server";
import {
  countRecordsInputSchema,
  groupRecordsInputSchema,
  listRecordsInputSchema,
  listRecordsPageInputSchema,
  type listRecordsValueFilterNodeSchema,
} from "busabase-contract/domains/base/contract/record-schemas";
import {
  type BaseFieldVO,
  combineViewFilters,
  flattenViewFilters,
  type ViewConfigVO,
  type ViewFilterVO,
} from "busabase-contract/types";
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
import type { BaseFieldPO, RecordPO } from "../../../db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseFieldValues,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
} from "../../../db/schema";
import { hydrateRecord, hydrateRecords } from "../../../logic/cr-lifecycle";
import {
  buildBaseVisibilityExists,
  buildNodeVisibilityExists,
  getEffectiveNodeLevel,
} from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import {
  listInputSchema,
  recordFieldFilterInputSchema,
  recordFieldGetInputSchema,
} from "../../../logic/store";
import {
  normalizeFieldValue,
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
  filterEvaluableRecordsByViewFilters,
  filterRecordsByViewFilters,
  GROUPABLE_FIELD_TYPES,
  groupKeyForValue,
} from "../utils/view-records";

import { commitPayloadWithFields } from "./commit-payload-projection";
import { lookupDependentFieldSlugs, lookupFormulaInputSlugs } from "./lookup-formulas";
import { filterRecordsForFind, resolveRecordFindFields } from "./record-find";
import { resolveRecordSort } from "./record-sort";
import { assertNoReverseRelationQueryOrThrow, collectFieldSlugs } from "./reverse-relations";
import {
  conditionsReadLookups,
  executeRows,
  planViewSql,
  selectOrderedRecordIds,
} from "./view-sql-plan";

export { listInputSchema, recordFieldFilterInputSchema, recordFieldGetInputSchema };

/**
 * Live fields of exactly these Bases, grouped by `baseId`. One query scoped to
 * the ids, then one pass to group them.
 *
 * Both Base listings used to read every field in the space (archived Bases'
 * included) and re-scan that whole array once per Base, so the cost grew with
 * bases × fields. `bases.list` runs on every dashboard page, and in a space
 * with 880 Bases of 10 fields it took ~470ms (`scripts/bench-sidebar.ts`).
 */
/**
 * `bases.list({ fields })`: `all` is every live field; `links` keeps only the
 * fields that connect Bases (relation targets, lookups, inverse relations). A
 * screen that only needs to know how Bases connect, like the Base design page
 * checking what else depends on a field, otherwise downloads every field of
 * every Base in the space.
 */
type BaseListFields = "all" | "links";
const LINK_FIELD_TYPES: BaseFieldPO["type"][] = ["relation", "lookup"];

const listFieldRowsByBaseId = async (
  db: Awaited<ReturnType<typeof getDb>>,
  baseIds: string[],
  fields: BaseListFields = "all",
): Promise<Map<string, BaseFieldPO[]>> => {
  const fieldsByBaseId = new Map<string, BaseFieldPO[]>();
  if (baseIds.length === 0) return fieldsByBaseId;
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(
      and(
        inArray(busabaseBaseFields.baseId, baseIds),
        isNull(busabaseBaseFields.deletedAt),
        fields === "links" ? inArray(busabaseBaseFields.type, LINK_FIELD_TYPES) : undefined,
      ),
    )
    .orderBy(asc(busabaseBaseFields.position));
  for (const field of fieldRows) {
    const fields = fieldsByBaseId.get(field.baseId);
    if (fields) fields.push(field);
    else fieldsByBaseId.set(field.baseId, [field]);
  }
  return fieldsByBaseId;
};

export const listBases = async ({ fields = "all" }: { fields?: BaseListFields } = {}) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select({ base: busabaseBases })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.archivedAt),
        buildNodeVisibilityExists(db, busabaseBases.nodeId),
      ),
    )
    .orderBy(asc(busabaseBases.createdAt));
  const fieldsByBaseId = await listFieldRowsByBaseId(
    db,
    baseRows.map(({ base }) => base.id),
    fields,
  );
  return baseRows.map(({ base }) => toBaseVO(base, fieldsByBaseId.get(base.id) ?? []));
};

export const getBase = async (baseId: string) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // An active exact id wins over an active slug, so a record QR cannot be
  // redirected by a later slug collision. An active slug wins over an archived
  // id, preserving the live Base when its slug is reused. Archived ids remain
  // reachable for restore / notice flows. Permanently deleted Bases are excluded:
  // once purged there is no restore flow left, so it must resolve to "not
  // found" like everything else that's been purged.)
  // Node ACL: a base whose node the actor can't see resolves to null here —
  // indistinguishable from a base that doesn't exist.
  const visible = buildNodeVisibilityExists(db, busabaseBases.nodeId);
  const [byId] = await db
    .select({ base: busabaseBases })
    .from(busabaseBases)
    .where(
      and(
        or(eq(busabaseBases.id, baseId), eq(busabaseBases.nodeId, baseId)),
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.deletedAt),
        isNull(busabaseBases.archivedAt),
        visible,
      ),
    )
    .limit(1);
  const [bySlug] = byId
    ? []
    : await db
        .select({ base: busabaseBases })
        .from(busabaseBases)
        .where(
          and(
            eq(busabaseBases.slug, baseId),
            eq(busabaseBases.spaceId, spaceId),
            isNull(busabaseBases.archivedAt),
            visible,
          ),
        )
        .limit(1);
  const [archivedById] =
    byId || bySlug
      ? []
      : await db
          .select({ base: busabaseBases })
          .from(busabaseBases)
          .where(
            and(
              or(eq(busabaseBases.id, baseId), eq(busabaseBases.nodeId, baseId)),
              eq(busabaseBases.spaceId, spaceId),
              isNull(busabaseBases.deletedAt),
              visible,
            ),
          )
          .limit(1);
  const row = byId ?? bySlug ?? archivedById;
  if (!row) {
    return null;
  }
  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, row.base.id), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position));
  return toBaseVO(row.base, fields);
};

/** The open Base's RPC response and SSR seed must carry the same effective permission. */
export const getBaseWithViewerPermission = async (baseId: string) => {
  const base = await getBase(baseId);
  if (!base) return null;
  // getBase already hides invisible Bases. Preserve the RPC's existing fallback
  // if no level resolves rather than inventing a grant.
  const viewerPermissionLevel = await getEffectiveNodeLevel(base.nodeId);
  return viewerPermissionLevel ? { ...base, viewerPermissionLevel } : base;
};

export const listViews = async (baseId?: string) => {
  await ensureReady();
  const db = await getDb();
  const resolvedBase = baseId ? await getBase(baseId) : null;
  // An unresolved target must not turn a scoped request into a workspace listing.
  if (baseId !== undefined && !resolvedBase) return [];
  const viewRows = resolvedBase
    ? await db
        .select()
        .from(busabaseViews)
        .where(and(eq(busabaseViews.baseId, resolvedBase.id), eq(busabaseViews.status, "active")))
        // Shared tab order; the first row is the view the Base opens on.
        .orderBy(asc(busabaseViews.position), asc(busabaseViews.createdAt), asc(busabaseViews.id))
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
        // Any one Base's views, filtered out of this list, come in its shared
        // tab order.
        .orderBy(asc(busabaseViews.position), asc(busabaseViews.createdAt), asc(busabaseViews.id))
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
  assertNoReverseRelationQueryOrThrow(base.fields, collectFieldSlugs(nodes), "filter");
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

type HydratedRecord = Awaited<ReturnType<typeof hydrateRecord>>;
type RecordSort = { fieldSlug: string; direction: "asc" | "desc" };
const hydratedSortValue = (record: HydratedRecord, slug: string, kind: "number" | "date") => {
  const raw = record.headCommit.payload[slug];
  if (raw === null || raw === undefined || raw === "") return null;
  if (kind === "date") {
    const date = new Date(raw as string | number);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
};
const compareHydratedSortKey = (
  record: HydratedRecord,
  other: { value: number | Date | null; id: string },
  sort: RecordSort,
  kind: "number" | "date",
): number => {
  const value = hydratedSortValue(record, sort.fieldSlug, kind);
  if (value === null && other.value !== null) return 1;
  if (value !== null && other.value === null) return -1;
  if (value !== null && other.value !== null && +value !== +other.value) {
    return (+value < +other.value ? -1 : 1) * (sort.direction === "asc" ? 1 : -1);
  }
  return record.id < other.id ? -1 : record.id === other.id ? 0 : 1;
};
const sortHydratedRecords = (
  records: HydratedRecord[],
  sort: RecordSort,
  kind: "number" | "date",
) =>
  records.sort((left, right) =>
    compareHydratedSortKey(
      left,
      {
        value: hydratedSortValue(right, sort.fieldSlug, kind),
        id: right.id,
      },
      sort,
      kind,
    ),
  );

/**
 * Records per `hydrateRecords` call on the paths that must hydrate a whole
 * candidate set (lookup sorts and lookup matches). Hydration binds one
 * parameter per head commit, and Postgres refuses a statement with more than
 * 65,535 of them, so an unchunked call on a big enough set is a 500 rather
 * than a slow answer. The chunks are concatenated in input order, which is all
 * the callers rely on.
 */
const HYDRATE_CHUNK_SIZE = 5_000;
const hydrateRecordsInChunks = async (
  rows: RecordPO[],
  options?: Parameters<typeof hydrateRecords>[1],
): Promise<HydratedRecord[]> => {
  if (rows.length <= HYDRATE_CHUNK_SIZE) return hydrateRecords(rows, options);
  const hydrated: HydratedRecord[] = [];
  for (let start = 0; start < rows.length; start += HYDRATE_CHUNK_SIZE) {
    for (const record of await hydrateRecords(
      rows.slice(start, start + HYDRATE_CHUNK_SIZE),
      options,
    )) {
      hydrated.push(record);
    }
  }
  return hydrated;
};

/** The 400 for a space-wide sort on a lookup-dependent slug, naming where it lives. */
const dynamicSortNeedsBaseMessage = (
  fieldSlug: string,
  bases: ReadonlyArray<{ id: string; slug: string }>,
): string => {
  const listed = bases
    .slice(0, 5)
    .map((base) => `${base.slug} (${base.id})`)
    .join(", ");
  const more = bases.length > 5 ? `, … (${bases.length} Bases)` : "";
  return (
    `sort: pass baseId to sort by "${fieldSlug}". It is a lookup, or a formula that reads one, ` +
    `in ${listed}${more}: its value is computed per record when read, so it only orders the ` +
    `records of one Base, and sorting the whole space by it would compute it for every record ` +
    `in the space first.`
  );
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
 * A record listing's optional `baseId` → the Base it names, by id OR slug (the
 * same resolution `bases.get` uses). Unknown or invisible is a 404.
 *
 * The listings used to compare `baseId` straight against `records.base_id`, so
 * a slug — what every agent has in hand after `bases.list` — matched nothing
 * and came back as an empty, successful page: "this Base has no records".
 */
const resolveListingBase = async (baseId: string) => {
  const base = await getBase(baseId);
  if (!base) {
    throw new ORPCError("NOT_FOUND", {
      message: `Base not found: ${baseId}. Pass a Base id or slug from GET /bases.`,
    });
  }
  return base;
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
  const base = parsed.baseId ? await resolveListingBase(parsed.baseId) : null;
  if (base) {
    filters.push(eq(busabaseRecords.baseId, base.id));
  }
  // Settle the sort's field type before anything branches on it: an omitted
  // `fieldType` is read from the Base's schema, an unknown slug is a 400.
  const sort = parsed.sort ? resolveRecordSort(parsed.sort, base?.fields ?? null) : undefined;
  const queriedBases =
    parsed.filters?.length || sort
      ? parsed.baseId
        ? [await getBase(parsed.baseId)].filter((base) => base !== null)
        : await listBases()
      : [];
  const dynamicSlugs = new Set(
    queriedBases.flatMap((base) => [...lookupDependentFieldSlugs(base.fields)]),
  );
  if (parsed.baseId) {
    for (const queried of queriedBases) {
      assertNoReverseRelationQueryOrThrow(
        queried.fields,
        collectFieldSlugs([parsed.filters, sort]),
        "filter or sort",
      );
    }
  }
  // Best-effort server-side view-filter push-down (superset; the client filter
  // stays authoritative). Non-pushable filters are skipped here. Applies to both
  // the sort and default paths below.
  if (parsed.filters) {
    for (const filter of parsed.filters) {
      const condition = dynamicSlugs.has(filter.fieldSlug)
        ? null
        : buildPushableRecordFilter(db, filter);
      if (condition) {
        filters.push(condition);
      }
    }
  }
  // Exact value comparisons, ANDed on top. Unlike the superset filters above,
  // every one of these either becomes SQL or raises — so whatever survives here
  // makes the returned row set authoritative for the conditions given.
  if (parsed.valueFilters?.length) {
    if (!base) {
      throw new ORPCError("BAD_REQUEST", {
        message: "valueFilters requires baseId — a field slug only resolves within one Base",
      });
    }
    filters.push(...(await buildValueFilterPredicates(db, base.id, parsed.valueFilters)));
  }

  const sortInfo = sort ? sortColumnFor(sort.fieldType) : null;
  if (sort && sortInfo && dynamicSlugs.has(sort.fieldSlug)) {
    if (!base) {
      // A lookup's value is computed per record at read time, so sorting by it
      // means hydrating every candidate first. Without a Base the candidates are
      // every record in the space — 96k in a real one, past the bind-parameter
      // limit of the hydration read, so this was a 500 — and the slug only
      // means that lookup inside the Bases that define it anyway.
      throw new ORPCError("BAD_REQUEST", {
        message: dynamicSortNeedsBaseMessage(
          sort.fieldSlug,
          queriedBases.filter((queried) =>
            lookupDependentFieldSlugs(queried.fields).has(sort.fieldSlug),
          ),
        ),
        data: { reason: "sort_field_requires_base", fieldSlug: sort.fieldSlug },
      });
    }
    // No source-Base edit refreshes the stored projection. Resolve first, then
    // use the same numeric/date NULLS LAST ordering and keyset cursor as SQL.
    const rows = await db
      .select()
      .from(busabaseRecords)
      .where(and(...filters));
    const ordered = sortHydratedRecords(await hydrateRecordsInChunks(rows), sort, sortInfo.kind);
    const cursor = parsed.cursor ? decodeSortCursor(parsed.cursor, sortInfo.kind) : null;
    const candidates = cursor
      ? ordered.filter((record) => compareHydratedSortKey(record, cursor, sort, sortInfo.kind) > 0)
      : ordered;
    const page = candidates.slice(0, parsed.limit);
    const last = page.at(-1);
    let records = page;
    if (parsed.summary) {
      const ids = new Set(page.map((record) => record.id));
      const summaries = await hydrateRecords(
        rows.filter((row) => ids.has(row.id)),
        { summary: true },
      );
      const byId = new Map(summaries.map((record) => [record.id, record]));
      records = page.flatMap((record) => {
        const summary = byId.get(record.id);
        return summary ? [summary] : [];
      });
    }
    return {
      records,
      nextCursor:
        candidates.length > parsed.limit && last
          ? encodeSortCursor(hydratedSortValue(last, sort.fieldSlug, sortInfo.kind), last.id)
          : null,
    };
  }
  if (sort && sortInfo) {
    // ── Sort-field keyset path (number/date). ORDER BY the typed value column
    // NULLS LAST, id ASC as a stable tiebreaker. The keyset predicate mirrors
    // that ordering so paging never skips or repeats a row. ──
    const { col: sortCol, kind } = sortInfo;
    const direction = sort.direction;
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
          eq(busabaseFieldValues.fieldSlug, sort.fieldSlug),
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
    const records = await hydrateRecords(
      pageRows.map((row) => row.record),
      {
        summary: parsed.summary,
      },
    );
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

  const records = await hydrateRecords(pageRows, { summary: parsed.summary });
  return { records, nextCursor };
};

/**
 * `records.listPage`'s explicit `sort`, as SQL ORDER BY terms — or null when
 * there is nothing to push down.
 *
 * Same semantics as `records.list`'s sort (`sortColumnFor` decides, from the
 * sort's `fieldType` — the caller's, or the Base schema's when omitted, see
 * `resolveRecordSort` — exactly as it does there): number/date fields order by
 * their typed value column with NULLS LAST; any other type is not sorted here.
 * The tiebreaker is `id ASC` in both directions, like `records.list`, which is
 * what makes OFFSET paging deterministic: ties on the value would otherwise
 * come back in whatever order the engine likes, and page N+1 could repeat a
 * record from page N while another one is never shown.
 *
 * The value is read with a scalar subquery + LIMIT 1 rather than `records.list`'s
 * LEFT JOIN. `busabase_field_values` has no `(record_id, field_slug)` unique
 * index, so a stray duplicate projection row would make a JOIN emit a record
 * twice — tolerable for a keyset cursor, but here it would desynchronise the
 * page slices from the SQL COUNT `total` that is computed separately.
 */
const buildPageSortOrder = (
  db: Awaited<ReturnType<typeof getDb>>,
  sort: z.infer<typeof listRecordsPageInputSchema>["sort"],
): SQL[] | null => {
  if (!sort) return null;
  const sortInfo = sortColumnFor(sort.fieldType);
  if (!sortInfo) return null;
  const sortKey = db
    .select({ value: sortInfo.col })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.recordId, busabaseRecords.id),
        eq(busabaseFieldValues.fieldSlug, sort.fieldSlug),
        isNull(busabaseFieldValues.deletedAt),
      ),
    )
    .orderBy(desc(busabaseFieldValues.createdAt), desc(busabaseFieldValues.id))
    .limit(1);
  return [
    sort.direction === "asc" ? sql`(${sortKey}) asc nulls last` : sql`(${sortKey}) desc nulls last`,
    asc(busabaseRecords.id),
  ];
};

/**
 * Random-access pagination for Table/Gallery views. Saved-view filtering and
 * sorting is deliberately authoritative here: the complete visible candidate
 * set is hydrated first, then filtered/sorted, and only then sliced. This keeps
 * totals and every page correct for complex fields that cannot be expressed by
 * the field-value SQL projection yet.
 *
 * An explicit `sort` REPLACES the View's saved sort (its filters still apply):
 * the caller asked for an order, so the View only decides which records are
 * in. A number/date `sort` is ordered in SQL (see `buildPageSortOrder`); any
 * other field type, as on `records.list`, leaves the default order.
 */
export const listRecordsPage = async (input: z.input<typeof listRecordsPageInputSchema>) => {
  await ensureReady();
  const db = await getDb();
  const parsed = listRecordsPageInputSchema.parse(input);
  const tableListMode = parsed.listMode === "table";
  const hydratePageRows = (rows: RecordPO[]) =>
    hydrateRecords(
      rows,
      tableListMode
        ? {
            summary: true,
            preserveBaseSchema: true,
            includeComputedFields: true,
            keepWhiteboardPreview: true,
          }
        : undefined,
    );
  const base = await getBase(parsed.baseId);
  if (!base) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${parsed.baseId}` });
  }
  const findFields = parsed.find ? resolveRecordFindFields(base.fields, parsed.find) : [];
  const findSlugs = findFields.map((field) => field.slug);
  // An omitted `fieldType` is read from the Base's schema; an unknown slug is a 400.
  const sort = parsed.sort ? resolveRecordSort(parsed.sort, base.fields) : undefined;

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
          filters: combineViewFilters(viewConfig, parsed.filters),
          // An explicit `sort` replaces the View's — see the doc above.
          sorts: sort ? [] : (viewConfig?.sorts ?? []),
        }
      : undefined;
  assertNoReverseRelationQueryOrThrow(
    base.fields,
    collectFieldSlugs([effectiveViewConfig, sort, parsed.dateRange]),
    "filter or sort",
  );
  const explicitDynamicSort =
    sort && lookupDependentFieldSlugs(base.fields).has(sort.fieldSlug)
      ? sortColumnFor(sort.fieldType)
      : null;
  const sqlSortOrder = explicitDynamicSort ? null : buildPageSortOrder(db, sort);
  // Without an explicit sort this is exactly the order every path used before.
  const candidateOrder = sqlSortOrder ?? [
    desc(busabaseRecords.createdAt),
    desc(busabaseRecords.id),
  ];
  const needsExactViewEvaluation = Boolean(
    explicitDynamicSort ||
      (effectiveViewConfig &&
        (effectiveViewConfig.filters.length > 0 || effectiveViewConfig.sorts.length > 0)),
  );

  // The ordinary All view and presentation-only saved views can use true SQL
  // random access: count once, then hydrate only the requested page.
  if (!needsExactViewEvaluation && !parsed.find) {
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
      .orderBy(...candidateOrder)
      .limit(parsed.pageSize)
      .offset(offset);
    return {
      records: await hydratePageRows(rows),
      total,
      totalPages,
      page,
      pageSize: parsed.pageSize,
    };
  }

  // Saved views (and a board column's ad-hoc filter) are authoritative: the
  // page must be exactly the slice the view matcher and comparator in
  // utils/view-records.ts would produce over the whole visible Base.
  //
  // `planViewSql` decides as much of that in SQL as it can PROVE gives the
  // same answer: every root filter it can decide becomes a predicate, and when
  // every sort can be decided too, the comparator's order (sorts, then
  // `updatedAt desc`, then `id desc`) becomes the ORDER BY. A filtered, sorted
  // view of a 60k-record Base then reads one page instead of the Base. Whatever
  // it cannot decide is evaluated here, in process, over the rows the decided
  // filters already narrowed down to — the same functions as before, on fewer
  // rows, so the result cannot differ.
  //
  // Lookup values and formulas which depend on them are refreshed from other
  // records at hydration time. Their stored commits/projections cannot decide
  // view membership or order, so those conditions are never pushed; the
  // remaining candidates are hydrated before they are evaluated.
  const viewFilters = effectiveViewConfig?.filters ?? [];
  const viewSorts = effectiveViewConfig?.sorts ?? [];
  const plan = await planViewSql(db, {
    baseId: base.id,
    fields: base.fields,
    filters: viewFilters,
    // An explicit sort already decided the order (or needs hydration).
    sorts:
      parsed.find || sqlSortOrder || explicitDynamicSort || !needsExactViewEvaluation
        ? null
        : viewSorts,
    scope: recordFilters,
    provenLeaf: provenRecordFilterLeaf(db, base.id),
  });
  const narrowedFilters = [...recordFilters, ...plan.pushed];
  const residualConfig: ViewConfigVO = { filters: plan.residual, sorts: viewSorts };
  const viewOrder = sqlSortOrder ? null : plan.order;
  const hasSqlOrder = Boolean(sqlSortOrder || viewOrder || !needsExactViewEvaluation);
  const dynamicSlugs = lookupDependentFieldSlugs(base.fields);
  const dependsOnLookup = Boolean(
    explicitDynamicSort ||
      conditionsReadLookups(base.fields, plan.residual) ||
      (!hasSqlOrder && viewSorts.some((viewSort) => dynamicSlugs.has(viewSort.fieldSlug))),
  );
  const slicePage = async (orderedIds: string[]) => {
    const total = orderedIds.length;
    const totalPages = Math.ceil(total / parsed.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(parsed.page, totalPages);
    const offset = (page - 1) * parsed.pageSize;
    const pageIds = orderedIds.slice(offset, offset + parsed.pageSize);
    // Hydrate only the page, then restore the order the view decided (the
    // WHERE ... IN read comes back in whatever order the engine likes).
    const pageRecords = pageIds.length
      ? await hydratePageRows(
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
  };

  if (!parsed.find && !dependsOnLookup && hasSqlOrder && plan.residual.length === 0) {
    // Fully decided: the same count-then-page random access as the All view.
    const [countRow] = await db
      .select({ value: count() })
      .from(busabaseRecords)
      .where(and(...narrowedFilters));
    const total = countRow?.value ?? 0;
    const totalPages = Math.ceil(total / parsed.pageSize);
    const page = totalPages === 0 ? 1 : Math.min(parsed.page, totalPages);
    const offset = (page - 1) * parsed.pageSize;
    let rows: RecordPO[];
    if (viewOrder) {
      const pageIds = await selectOrderedRecordIds(db, viewOrder, narrowedFilters, {
        limit: parsed.pageSize,
        offset,
      });
      const byId = new Map(
        (pageIds.length
          ? await db.select().from(busabaseRecords).where(inArray(busabaseRecords.id, pageIds))
          : []
        ).map((row) => [row.id, row]),
      );
      rows = pageIds.flatMap((recordId) => {
        const row = byId.get(recordId);
        return row ? [row] : [];
      });
    } else {
      rows = await db
        .select()
        .from(busabaseRecords)
        .where(and(...narrowedFilters))
        .orderBy(...(sqlSortOrder ?? candidateOrder))
        .limit(parsed.pageSize)
        .offset(offset);
    }
    return {
      records: await hydratePageRows(rows),
      total,
      totalPages,
      page,
      pageSize: parsed.pageSize,
    };
  }

  // Membership and order read only a record's field values, its id and its
  // updatedAt, so the candidates are read as `(id, updatedAt, fields)` rows —
  // only the fields still to be evaluated — and just the page is hydrated.
  const residualSlugs = flattenViewFilters(plan.residual).flatMap((filter) => {
    const slug = filter.fieldId
      ? base.fields.find((field) => field.id === filter.fieldId)?.slug
      : filter.fieldSlug;
    return slug ? [slug] : [];
  });
  const sortSlugs = hasSqlOrder ? [] : viewSorts.map((viewSort) => viewSort.fieldSlug);

  if (!dependsOnLookup) {
    const [candidateRows, orderedIds] = await Promise.all([
      db
        .select({
          id: busabaseRecords.id,
          updatedAt: busabaseRecords.updatedAt,
          fields: commitPayloadWithFields([...residualSlugs, ...sortSlugs, ...findSlugs]).as(
            "fields",
          ),
        })
        .from(busabaseRecords)
        .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
        .where(and(...narrowedFilters))
        .orderBy(...(sqlSortOrder ?? candidateOrder)),
      viewOrder ? selectOrderedRecordIds(db, viewOrder, narrowedFilters) : null,
    ]);
    const rowsInOrder = orderedIds
      ? (() => {
          const byId = new Map(candidateRows.map((row) => [row.id, row]));
          return orderedIds.flatMap((recordId) => {
            const row = byId.get(recordId);
            return row ? [row] : [];
          });
        })()
      : candidateRows;
    const evaluable = rowsInOrder.map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt.toISOString(),
      fields: (row.fields ?? {}) as Record<string, unknown>,
    }));
    // With a SQL order the rows already arrive in their final order, so only
    // filter: the view comparator would re-sort them by its own fallback.
    const filtered =
      hasSqlOrder || parsed.find
        ? filterEvaluableRecordsByViewFilters(evaluable, base.fields, plan.residual)
        : applyViewConfigToEvaluableRecords(evaluable, base.fields, residualConfig);
    const matched = await filterRecordsForFind(db, filtered, findFields, parsed.find);
    // Find membership does not depend on order. Rank only the matches using
    // the canonical comparator instead of building SQL ranks for the full view.
    const ordered =
      parsed.find && !hasSqlOrder
        ? applyViewConfigToEvaluableRecords(matched, base.fields, {
            filters: [],
            sorts: viewSorts,
          })
        : matched;
    return slicePage(ordered.map((row) => row.id));
  }

  const candidateRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...narrowedFilters))
    .orderBy(...(sqlSortOrder ?? candidateOrder));
  // These rows only decide membership and order, so they carry the fields still
  // to be evaluated plus the inputs of read-time formulas. The page itself is
  // hydrated by `slicePage`.
  const candidates = await hydrateRecords(candidateRows, {
    payloadFields: [
      ...residualSlugs,
      ...viewSorts.map((viewSort) => viewSort.fieldSlug),
      ...(explicitDynamicSort && sort ? [sort.fieldSlug] : []),
      ...lookupFormulaInputSlugs(base.fields),
      ...findSlugs,
    ],
  });
  if (parsed.find) {
    const filtered = filterRecordsByViewFilters(candidates, plan.residual);
    const matched = await filterRecordsForFind(
      db,
      filtered.map((record) => ({ ...record, fields: record.headCommit.payload })),
      findFields,
      parsed.find,
    );
    const ordered =
      explicitDynamicSort && sort
        ? sortHydratedRecords(matched, sort, explicitDynamicSort.kind)
        : sqlSortOrder
          ? matched
          : applyViewConfigToRecords(matched, { filters: [], sorts: viewSorts });
    return slicePage(ordered.map((record) => record.id));
  }
  const ordered =
    explicitDynamicSort && sort
      ? sortHydratedRecords(
          filterRecordsByViewFilters(candidates, plan.residual),
          sort,
          explicitDynamicSort.kind,
        )
      : sqlSortOrder
        ? filterRecordsByViewFilters(candidates, plan.residual)
        : applyViewConfigToRecords(candidates, residualConfig);
  const matched = await filterRecordsForFind(
    db,
    ordered.map((record) => ({
      id: record.id,
      updatedAt: record.updatedAt,
      fields: record.headCommit.payload,
    })),
    findFields,
    parsed.find,
  );
  return slicePage(matched.map((record) => record.id));
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
// operators need `planViewSql`'s longest-stored-text check before trusting
// their predicate.
const TRUNCATION_SENSITIVE_OPERATORS = new Set(["contains", "equals"]);

/**
 * True when `buildExactRecordFilter` below can build a SQL predicate proven
 * identical to `recordMatchesViewFilter` for this (operator, real field type,
 * value) combination. Anything not enumerated here is NOT assumed exact — it
 * routes `countRecords` to the hydrate/evaluate fallback instead.
 *
 * NOTE: this alone is necessary but not SUFFICIENT for `contains`/`equals` on
 * a text type — the aggregates additionally require that no stored text of the
 * field reaches `VALUE_TEXT_INDEX_LIMIT` before trusting this "true", since
 * truncation is a per-field-data fact this (operator, type, value) triple
 * can't see.
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
  baseId: string,
  filter: { fieldSlug: string; operator: string; value?: unknown },
  field: ExactFilterField | undefined,
): SQL => {
  const type = field?.type ?? "";
  // "Some live projected row of the record satisfies `predicate`", as a
  // semi-join on the field's own rows: a record's rows carry its Base id, so
  // this reads the (base, field) index once and hashes, instead of probing
  // every candidate record's rows the way a correlated EXISTS does.
  const matches = (predicate: SQL): SQL =>
    inArray(
      busabaseRecords.id,
      db
        .select({ recordId: busabaseFieldValues.recordId })
        .from(busabaseFieldValues)
        .where(
          and(
            eq(busabaseFieldValues.baseId, baseId),
            eq(busabaseFieldValues.fieldSlug, filter.fieldSlug),
            isNull(busabaseFieldValues.deletedAt),
            isNotNull(busabaseFieldValues.recordId),
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
 * `planViewSql`'s `provenLeaf`: the pairs `isFilterExactlyPushable` proves
 * from the (operator, field type, value) alone. `contains`/`equals` on a text
 * field are left out — whether their stored text was cut short at
 * VALUE_TEXT_INDEX_LIMIT is a fact about the data, which the planner reads.
 */
const provenRecordFilterLeaf =
  (db: Awaited<ReturnType<typeof getDb>>, baseId: string) =>
  (filter: ViewFilterVO, field: BaseFieldVO): SQL | null => {
    // Identity is authoritative after a rename; SQL predicates address slugs,
    // so defer a stale slug to the identity-aware shared matcher.
    if (field.slug !== filter.fieldSlug) return null;
    if (TRUNCATION_SENSITIVE_OPERATORS.has(filter.operator) && EXACT_TEXT_TYPES.has(field.type)) {
      return null;
    }
    if (!isFilterExactlyPushable(filter.operator, field, filter.value)) return null;
    return buildExactRecordFilter(db, baseId, filter, field);
  };

/**
 * Shared scope resolution for the exactness-sensitive aggregates
 * (`countRecords`, `groupRecords`). Both publish a number a dashboard renders
 * as authoritative, so both need the same question answered: can this
 * (View filters + ad-hoc filters) set become a SQL predicate PROVEN identical
 * to `recordMatchesViewFilter`, or must the caller evaluate every row instead?
 *
 * The answer is per root condition: `plan.pushed` is the SQL to AND into the
 * aggregate, `plan.residual` what the caller must still evaluate in process —
 * over the rows `plan.pushed` already narrowed down to. An empty residual means
 * the aggregate is a single SQL statement.
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

  let viewConfig: ViewConfigVO | undefined;
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
    viewConfig = normalizeViewConfig(view.config);
  }
  // View filters AND ad-hoc filters when both are given — "this View, further
  // narrowed by these extra conditions" is the only reading that makes sense
  // for a dashboard tile built on top of a saved View.
  const allFilters = combineViewFilters(viewConfig, adHocFilters);
  assertNoReverseRelationQueryOrThrow(base.fields, collectFieldSlugs(allFilters), "filter");

  // Each root condition goes to SQL when `planViewSql` can prove it, first from
  // the field's distinct stored texts, then — for a field with too many of them
  // — through the predicates proven above (`isFilterExactlyPushable`). A
  // `contains`/`equals` on a text field whose stored text may be cut short at
  // VALUE_TEXT_INDEX_LIMIT can't trust its predicate (see
  // TRUNCATION_SENSITIVE_OPERATORS), so it stays in process.
  const plan = await planViewSql(db, {
    baseId: base.id,
    fields: base.fields,
    filters: allFilters,
    sorts: null,
    scope: [],
    provenLeaf: provenRecordFilterLeaf(db, base.id),
    fallbackLeaf: (filter, field, truncated) => {
      // Identity is authoritative after a rename; SQL predicates address slugs,
      // so defer a stale slug to the identity-aware shared matcher.
      if (field.slug !== filter.fieldSlug || truncated) return null;
      if (!isFilterExactlyPushable(filter.operator, field, filter.value)) return null;
      return buildExactRecordFilter(db, base.id, filter, field);
    },
  });

  return {
    base,
    allFilters,
    plan,
    // Lookups and their transitive formula dependents need hydration before
    // filtering; their committed projections do not track source-record edits.
    dependsOnLookup: conditionsReadLookups(base.fields, plan.residual),
    /** Fields the in-process evaluation of `plan.residual` reads. */
    residualSlugs: flattenViewFilters(plan.residual).flatMap((filter) => {
      const slug = filter.fieldId
        ? base.fields.find((field) => field.id === filter.fieldId)?.slug
        : filter.fieldSlug;
      return slug ? [slug] : [];
    }),
  };
};

/**
 * Count active records in the current space, a Base, a saved View, an ad-hoc
 * filter set, or a combination. Feeds "N of total" table headers and AirApp
 * summary tiles — the number MUST be exact (never a superset/partial count).
 *
 * Every root filter `resolveAggregateFilterScope` can prove goes into a real
 * SQL COUNT. Whatever it can't is evaluated in process with the same view
 * matcher `listRecordsPage` uses, over the rows the proven filters already
 * narrowed down to — still exact, and only as expensive as what is left.
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
  // Resolved like the listings (id or slug; unknown → 404). A count against a
  // slug used to be a plain 0 — the same silent "empty Base" answer.
  const countBase = parsed.baseId ? await resolveListingBase(parsed.baseId) : null;
  if (countBase) {
    baseFilters.push(eq(busabaseRecords.baseId, countBase.id));
  }
  // Pushed into the BASE filters, not into the exact-path predicates, so every
  // route below inherits them — the fast SQL count, the proven-exact count, and
  // both in-memory fallbacks. The fallbacks only know about `allFilters`, so a
  // value filter left out here would be silently dropped on those paths.
  //
  // They are also exact by construction, so unlike an ad-hoc view `filters` set
  // they never push a count off its single-`count(*)` fast path.
  if (parsed.valueFilters?.length && countBase) {
    baseFilters.push(...(await buildValueFilterPredicates(db, countBase.id, parsed.valueFilters)));
  }

  const sqlCount = async (extra: SQL[] = []) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(busabaseRecords)
      .where(and(...baseFilters, ...extra));
    return { total: row?.count ?? 0 };
  };

  // Fast path: unchanged from before viewId/filters existed on this endpoint.
  if (!parsed.viewId && !parsed.filters?.length) {
    return sqlCount();
  }

  // viewId/filters both require baseId (schema-enforced), so the Base — and
  // its real field definitions, which exactness depends on — is always
  // resolvable from here on.
  const { base, plan, dependsOnLookup, residualSlugs } = await resolveAggregateFilterScope(
    db,
    countBase?.id ?? (parsed.baseId as string),
    parsed.viewId,
    parsed.filters,
  );

  if (plan.residual.length === 0) {
    // Includes the "viewId pointed at a view with no filters" case, where the
    // predicate list is empty and this is a plain SQL COUNT.
    return sqlCount(plan.pushed);
  }

  // Exact, not free: the conditions SQL could not decide are evaluated the way
  // `listRecordsPage`'s exact-view path does, over the candidates the decided
  // ones already narrowed to, reading only the fields those conditions name.
  const narrowedFilters = [...baseFilters, ...plan.pushed];
  if (!dependsOnLookup) {
    const candidateRows = await db
      .select({
        id: busabaseRecords.id,
        updatedAt: busabaseRecords.updatedAt,
        fields: commitPayloadWithFields(residualSlugs).as("fields"),
      })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(and(...narrowedFilters));
    const matched = filterEvaluableRecordsByViewFilters(
      candidateRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        fields: (row.fields ?? {}) as Record<string, unknown>,
      })),
      base.fields,
      plan.residual,
    );
    return { total: matched.length };
  }

  const candidateRecordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...narrowedFilters));
  const candidates = await hydrateRecords(candidateRecordRows, {
    payloadFields: [...residualSlugs, ...lookupFormulaInputSlugs(base.fields)],
  });
  return { total: filterRecordsByViewFilters(candidates, plan.residual).length };
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

  const { base, plan, dependsOnLookup, residualSlugs } = await resolveAggregateFilterScope(
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
  assertNoReverseRelationQueryOrThrow(
    base.fields,
    [...(groupSlug ? [groupSlug] : []), ...collectFieldSlugs(parsed.aggregates ?? [])],
    "group or aggregate",
  );
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
  // added to `baseFilters` rather than to `plan.pushed` so BOTH paths honour
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

  if (
    plan.residual.length === 0 &&
    groupSlug &&
    aggregates.length === 0 &&
    groupColumn() !== busabaseFieldValues.valueDate
  ) {
    // Plain counts per value: the field's rows of this Base are read once
    // through the (base, field) index into a materialized set and hash-joined
    // to the records in scope. The scalar subquery below instead walks every
    // projected row of each record to find one field — on a database where
    // the Base is a small share of the table, 0.36 s → 0.05 s at 14k records
    // and 0.69 s → 0.13 s at 60k.
    //
    // A LEFT JOIN emits one row per record unless a record has two live rows
    // for the field (the projection's delete-then-insert should prevent it,
    // nothing enforces it). So the joined rows must add up to the records in
    // scope; if they don't, the scalar subquery path below answers instead.
    // Dates stay there too: they come back from a raw query as text, not as
    // the instants that path buckets.
    const column = groupColumn();
    const scope = and(...baseFilters, ...plan.pushed);
    const [groupRows, [scopeRow]] = await Promise.all([
      executeRows<{ group_value: unknown; count: number | string }>(
        db,
        sql`with group_keys as materialized (
          select ${busabaseFieldValues.recordId} as record_id, ${column} as group_value
          from ${busabaseFieldValues}
          where ${busabaseFieldValues.baseId} = ${base.id}
            and ${busabaseFieldValues.fieldSlug} = ${groupSlug}
            and ${busabaseFieldValues.deletedAt} is null
            and ${busabaseFieldValues.recordId} is not null
        )
        select group_keys.group_value, count(*)::int as count
        from ${busabaseRecords}
        left join group_keys on group_keys.record_id = ${busabaseRecords.id}
        where ${scope}
        group by group_keys.group_value`,
      ),
      db.select({ count: sql<number>`count(*)::int` }).from(busabaseRecords).where(scope),
    ]);
    const joined = groupRows.reduce((sum, row) => sum + Number(row.count), 0);
    if (joined === Number(scopeRow?.count ?? 0)) {
      const counts = new Map<BucketKey, number>();
      for (const row of groupRows) {
        const key = bucketKeyFor(row.group_value);
        counts.set(key, (counts.get(key) ?? 0) + Number(row.count));
      }
      return toResponse(counts);
    }
  }

  if (plan.residual.length === 0) {
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
      .where(and(...baseFilters, ...plan.pushed))
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

  // Fallback: exact, not free — same shape as `countRecords`'s. Evaluate the
  // conditions SQL could not decide over the candidates the decided ones
  // narrowed to, then group the survivors by their raw commit value.
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
      let bucket = values.get(key);
      if (!bucket) {
        bucket = new Map<string, number[]>();
        values.set(key, bucket);
      }
      for (const slug of aggregateFieldSlugs) {
        const raw = record.fields[slug];
        const numeric = typeof raw === "number" ? raw : Number(raw);
        if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(numeric)) {
          // Appended in place: copying the list for every value made a group of
          // n records cost n² copies.
          const list = bucket.get(slug);
          if (list) list.push(numeric);
          else bucket.set(slug, [numeric]);
        }
      }
    }
    const perGroup = new Map<BucketKey, Record<string, number | null> | undefined>();
    for (const key of counts.keys()) {
      perGroup.set(key, aggregateOver(values.get(key) ?? new Map()));
    }
    return { counts, perGroup };
  };

  const narrowedFilters = [...baseFilters, ...plan.pushed];
  // Only what grouping, the aggregates and the undecided conditions read.
  const evaluatedSlugs = [
    ...residualSlugs,
    ...(groupSlug ? [groupSlug] : []),
    ...aggregateFieldSlugs,
  ];
  if (!dependsOnLookup) {
    const candidateRows = await db
      .select({
        id: busabaseRecords.id,
        updatedAt: busabaseRecords.updatedAt,
        fields: commitPayloadWithFields(evaluatedSlugs).as("fields"),
      })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
      .where(and(...narrowedFilters));
    const matched = filterEvaluableRecordsByViewFilters(
      candidateRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        fields: (row.fields ?? {}) as Record<string, unknown>,
      })),
      base.fields,
      plan.residual,
    );
    const built = countsFromRecords(matched);
    return toResponse(built.counts, aggregates.length ? built.perGroup : undefined);
  }

  const candidateRecordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(...narrowedFilters));
  const candidates = await hydrateRecords(candidateRecordRows, {
    payloadFields: [...evaluatedSlugs, ...lookupFormulaInputSlugs(base.fields)],
  });
  const matched = filterRecordsByViewFilters(candidates, plan.residual);
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

/**
 * Batched `getRecord`: the same space + Base-visibility filters, one row query
 * and ONE `hydrateRecords` pass for the whole set instead of one per id.
 * Archived records are returned, exactly as `getRecord` returns them. Ids that
 * do not resolve (missing, other space, or a Base the caller cannot read) are
 * reported in `missingIds` rather than failing the batch.
 */
export const getRecords = async (recordIds: readonly string[]) => {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return { records: [], missingIds: [] };
  await ensureReady();
  const db = await getDb();
  const rows = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(
        inArray(busabaseRecords.id, ids),
        eq(busabaseRecords.spaceId, getContextSpaceId()),
        buildBaseVisibilityExists(db, busabaseRecords.baseId),
      ),
    );
  const hydrated = new Map((await hydrateRecords(rows)).map((record) => [record.id, record]));
  const records: Awaited<ReturnType<typeof hydrateRecords>> = [];
  const missingIds: string[] = [];
  for (const id of ids) {
    const record = hydrated.get(id);
    if (record) records.push(record);
    else missingIds.push(id);
  }
  return { records, missingIds };
};

export const listRecordLinks = async (
  recordId: string,
  direction: "outbound" | "inbound" = "outbound",
) => {
  await ensureReady();
  const db = await getDb();
  if (direction === "inbound") {
    // Who links HERE: rows whose target is this record, from live source
    // records through live relation fields. Both ends must be visible — the
    // source Base because the row reveals a source record, the target Base
    // because it is this record's own Base.
    const rows = await db
      .select({ link: busabaseRecordLinks })
      .from(busabaseRecordLinks)
      .innerJoin(busabaseRecords, eq(busabaseRecords.id, busabaseRecordLinks.sourceRecordId))
      .innerJoin(busabaseBaseFields, eq(busabaseBaseFields.id, busabaseRecordLinks.fieldId))
      .where(
        and(
          eq(busabaseRecordLinks.spaceId, getContextSpaceId()),
          eq(busabaseRecordLinks.targetRecordId, recordId),
          isNull(busabaseRecordLinks.deletedAt),
          eq(busabaseRecords.status, "active"),
          isNull(busabaseBaseFields.deletedAt),
          buildBaseVisibilityExists(db, busabaseRecordLinks.baseId),
          buildBaseVisibilityExists(db, busabaseRecordLinks.targetBaseId),
        ),
      )
      .orderBy(asc(busabaseRecordLinks.createdAt), asc(busabaseRecordLinks.sourceRecordId));
    return rows.map((row) => toRecordLinkVO(row.link));
  }
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

/** Exact field lookup needs current values too, including cross-Base searches. */
const dynamicFieldMatches = async (
  baseId: string | undefined,
  fieldSlug: string,
  valueText: string,
) => {
  const bases = baseId
    ? [await getBase(baseId)].filter((base) => base !== null)
    : await listBases();
  if (baseId) {
    for (const base of bases) {
      assertNoReverseRelationQueryOrThrow(base.fields, [fieldSlug], "look up records");
    }
  }
  const dynamicBases = bases.filter((base) =>
    lookupDependentFieldSlugs(base.fields).has(fieldSlug),
  );
  const baseIds = dynamicBases.map((base) => base.id);
  if (!baseIds.length) return { baseIds, records: [] as HydratedRecord[] };
  const db = await getDb();
  const rows = await db
    .select()
    .from(busabaseRecords)
    .where(
      and(
        eq(busabaseRecords.spaceId, getContextSpaceId()),
        inArray(busabaseRecords.baseId, baseIds),
        eq(busabaseRecords.status, "active"),
        buildBaseVisibilityExists(db, busabaseRecords.baseId),
      ),
    );
  // Only the Bases where the slug is a lookup (or reads one) are hydrated — the
  // rest are matched on the stored projection by the caller. Even so, several
  // such Bases can add up past what one hydration read can bind, so they are
  // hydrated in chunks and only the matches are kept from each.
  const records: HydratedRecord[] = [];
  for (let start = 0; start < rows.length; start += HYDRATE_CHUNK_SIZE) {
    const chunk = await hydrateRecords(rows.slice(start, start + HYDRATE_CHUNK_SIZE));
    for (const record of chunk) {
      const field = record.base.fields.find((candidate) => candidate.slug === fieldSlug);
      if (
        normalizeFieldValue(record.headCommit.payload[fieldSlug], field?.type).valueText ===
        valueText
      ) {
        records.push(record);
      }
    }
  }
  return { baseIds, records };
};

export const listRecordsByFieldText = async (
  input: z.input<typeof recordFieldFilterInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const parsed = recordFieldFilterInputSchema.parse(input);
  const dynamic = await dynamicFieldMatches(parsed.baseId, parsed.fieldSlug, parsed.valueText);
  const filters: SQL[] = [
    ...(dynamic.baseIds.length ? [not(inArray(busabaseFieldValues.baseId, dynamic.baseIds))] : []),
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
    const base = await resolveListingBase(parsed.baseId);
    // Scoped to one Base, an unknown `fieldSlug` is a caller mistake, not "no
    // matches" — name the fields it could have been.
    if (!base.fields.some((field) => field.slug === parsed.fieldSlug)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Base ${base.slug} has no field "${parsed.fieldSlug}". Fields: ${base.fields
          .map((field) => field.slug)
          .join(", ")}.`,
      });
    }
    filters.push(eq(busabaseFieldValues.baseId, base.id));
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
    return dynamic.records
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      )
      .slice(0, parsed.limit);
  }

  const recordRows = await db
    .select()
    .from(busabaseRecords)
    .where(and(inArray(busabaseRecords.id, recordIds), eq(busabaseRecords.status, "active")));
  const recordsById = new Map(recordRows.map((record) => [record.id, record]));
  const records = await hydrateRecords(
    recordIds
      .map((recordId) => recordsById.get(recordId))
      .filter((record): record is RecordPO => Boolean(record)),
  );
  if (!dynamic.baseIds.length) return records;
  return [...records, ...dynamic.records]
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )
    .slice(0, parsed.limit);
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
  const dynamic = await dynamicFieldMatches(parsed.baseId, parsed.fieldSlug, parsed.valueText);
  if (dynamic.baseIds.length) {
    return (
      dynamic.records.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
      )[0] ?? null
    );
  }
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

export const listArchivedBases = async ({ fields = "all" }: { fields?: BaseListFields } = {}) => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const baseRows = await db
    .select({ base: busabaseBases })
    .from(busabaseBases)
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
  const fieldsByBaseId = await listFieldRowsByBaseId(
    db,
    baseRows.map(({ base }) => base.id),
    fields,
  );
  return baseRows.map(({ base }) => toBaseVO(base, fieldsByBaseId.get(base.id) ?? []));
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
    .orderBy(asc(busabaseViews.position), asc(busabaseViews.createdAt), asc(busabaseViews.id));
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
    filters.push(eq(busabaseRecords.baseId, (await resolveListingBase(parsed.baseId)).id));
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
  const records = await hydrateRecords(pageRows, { summary: parsed.summary });
  return { records, nextCursor };
};
