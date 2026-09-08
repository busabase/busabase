import { z } from "zod";
import { destructiveAutoMerge } from "../../../contract/auto-merge";
// Records embed the kernel commit VO. This is a one-way import — the kernel
// contract never imports record schemas — so there is no cycle and no z.lazy.
import {
  commitSchema,
  createDeleteChangeRequestInputSchema,
  reviseOperationInputSchema,
  userRefSchema,
} from "../../../contract/schemas";
import { baseSchema } from "./base-schemas";
import { viewFilterOperatorSchema } from "./view-schemas";

export const recordSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  headCommitId: z.string(),
  parentRecordId: z.string().nullable(),
  parentCommitId: z.string().nullable(),
  status: z.enum(["active", "archived"]),
  createdBy: z.string(),
  createdByUser: userRefSchema.nullable().optional().default(null),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  base: baseSchema,
  headCommit: commitSchema,
});

// A view filter carried to the server for best-effort push-down. `fieldType`
// lets the server decide pushability: only text/number/checkbox project a
// faithful value column, so only those are pushed (as a SUPERSET — the client's
// applyViewConfigToRecords stays the exact authority and narrows the rest).
export const listRecordsFilterSchema = z.object({
  fieldSlug: z.string(),
  fieldType: z.string().optional(),
  operator: viewFilterOperatorSchema,
  value: z.unknown().optional(),
});

// A view sort carried to the server for push-down. Only number/date fields sort
// authoritatively in SQL (their typed value column matches the client's ordering);
// other field types are left to the client sort. `fieldType` lets the server decide.
export const listRecordsSortSchema = z.object({
  fieldSlug: z.string(),
  fieldType: z.string().optional(),
  direction: z.enum(["asc", "desc"]).optional().default("asc"),
});

// Value-semantics filters, and a DIFFERENT contract from `filters` above.
//
// `filters` are VIEW filters: they mean what the grid means, so their authority
// is `recordMatchesViewFilter` comparing rendered preview TEXT — a currency
// number reads as "$1,234.00", a select reads as its choice label. That is the
// right semantics for "filter this view", and the wrong one for "give me the
// records whose score is over 40". It is also why they can only ever be pushed
// down as a superset.
//
// These compare the STORED value in its own typed column instead
// (`value_number` / `value_date` / `value_bool`, and `value_text` for the
// equality cases proven exact below), so there is no formatting layer to
// diverge from: the comparison is EXACT, and the server promises it. A caller
// may therefore trust the row set and push `limit` down with it — which is the
// whole point, and something `filters` can never offer.
//
// The exactness promise is kept by REFUSING rather than degrading: a field this
// cannot compare exactly is a 400, not a silently-dropped condition. Dropping
// one would hand back a superset while the caller believes it was filtered.
export const listRecordsValueFilterSchema = z.object({
  fieldSlug: z.string(),
  operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
  /**
   * A number for number fields, an ISO 8601 string for date fields, a boolean
   * for checkbox, and a string for the text-like families (where only `eq`/`ne`
   * are exact — see `buildExactValueFilter`).
   */
  value: z.union([z.number(), z.string(), z.boolean()]),
});

/**
 * One conjunct of `valueFilters`: either a single comparison, or a disjunction
 * of them.
 *
 * `valueFilters` is an AND of these, so an entry carrying `any` makes the whole
 * list a CNF (an AND of ORs) — which is enough to express ANY boolean
 * combination of comparisons, since every formula has a CNF. That is why this
 * is one flat level rather than an arbitrarily nested tree: a recursive schema
 * would buy no expressive power, and would cost a `z.lazy` that OpenAPI
 * generation and generated clients both handle worse than a plain union.
 *
 * NOT is deliberately absent, and is not a gap: every operator here has an
 * exact negation (`eq`↔`ne`, `gt`↔`lte`, `gte`↔`lt`), so a caller pushes
 * negation down to the leaves with De Morgan before sending. Keeping NOT out of
 * the wire format keeps the server's evaluation MONOTONE, which is what makes
 * the missing-value semantics below sound.
 *
 * Missing values: a comparison against a field the record has no row for is
 * false, never true — the `EXISTS` in `buildExactValueFilter` sees no row. That
 * collapses SQL's UNKNOWN to false at each leaf, which is safe here precisely
 * because the formula is monotone: for an AND/OR tree with no NOT, "Kleene
 * three-valued result is TRUE" and "result with UNKNOWN replaced by FALSE is
 * TRUE" agree (OR is `some operand true` and AND is `all operands true` under
 * both readings). A NOT anywhere in the tree would break that equivalence,
 * which is the other reason it is not on the wire.
 */
export const listRecordsValueFilterNodeSchema = z.union([
  listRecordsValueFilterSchema,
  z.object({ any: z.array(listRecordsValueFilterSchema).min(1) }),
]);

export const listRecordsInputSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(50)
      .describe("Records per page. Capped at 100; ask for the next page with `cursor`."),
    baseId: z
      .string()
      .optional()
      .describe(
        "Restrict to one Base. OMITTING it lists records across the WHOLE SPACE, which is " +
          "rarely what a caller means and is easy to miss — every other parameter still applies, " +
          "so an unscoped query looks like it worked.",
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "Opaque page cursor: pass back the `nextCursor` from the previous response. " +
          "Do not construct or parse it — it is keyed on `createdAt`, or on the sort field when " +
          "`sort` is given, and that is an implementation detail.",
      ),
    // Both statuses page identically, which is why this is one endpoint rather
    // than a `/records/archived` twin.
    status: z
      .enum(["active", "archived"])
      .optional()
      .default("active")
      .describe("`active` is the live table; `archived` is the Base's trash."),
    filters: z
      .array(listRecordsFilterSchema)
      .optional()
      .describe(
        "View filters — a best-effort SUPERSET, not an exact answer. They mean what the grid " +
          'means (a currency number reads as "$1,234.00", a select as its choice label), and ' +
          "the server may return records that do not match, so the caller must narrow them " +
          "again and must NOT trust `limit` alongside them. Use `valueFilters` when you need " +
          "an exact row set.",
      ),
    /**
     * Exact value comparisons. Unlike `filters` these are authoritative — the
     * returned rows are exactly those that match, so a caller can page and
     * limit against them. ANDed together (and with `filters` when both are
     * given); an entry may be a disjunction, making the list a CNF.
     */
    valueFilters: z
      .array(listRecordsValueFilterNodeSchema)
      .optional()
      .describe(
        "EXACT value comparisons, unlike `filters` which are a best-effort superset. " +
          "The returned rows are exactly those that match, so `limit` can be trusted alongside them. " +
          "Entries are ANDed; an entry may instead be `{ any: [...] }` to OR its comparisons, " +
          "which makes the list a CNF and can express any boolean combination. " +
          "Requires `baseId`. Compares number, date, checkbox and text-like fields (text and select " +
          "support eq/ne only); anything else is a 400 rather than a silently dropped condition.",
      ),
    sort: listRecordsSortSchema
      .optional()
      .describe(
        "Sort by one field. Only number and date fields sort authoritatively (their typed value " +
          "column matches a client's own ordering); any other field type is returned in the " +
          "default order and left for the caller to sort.",
      ),
  })
  .optional()
  .default({ limit: 50, status: "active" });

export const listRecordsResponseSchema = z.object({
  records: z.array(recordSchema),
  nextCursor: z.string().nullable(),
});

export const listRecordsPageInputSchema = z.object({
  baseId: z
    .string()
    .min(1)
    .describe("Required here, unlike `records.list` where omitting it spans the whole space."),
  viewId: z
    .string()
    .min(1)
    .optional()
    .describe("Show only what this saved View would: its filters and its sort."),
  /**
   * Extra conditions ANDed with the View's own filters — "this View, further
   * narrowed". The motivating case is one board column: the saved View's
   * filters plus `stackField equals <choice>`, paged independently of the
   * other columns.
   *
   * Unlike `records.list`'s `filters` (a SUPERSET push-down the client then
   * narrows), these are applied with the same authority as a saved View's:
   * every returned page is exactly what the client's own matcher would keep.
   * That distinction is the whole point — a *superset* page can be missing
   * records, and a board column that silently drops cards reads as data loss.
   */
  filters: z
    .array(listRecordsFilterSchema)
    .optional()
    .describe(
      'Extra conditions ANDed with the View\'s own — "this View, further narrowed". ' +
        "Unlike `records.list`'s `filters`, these are EXACT: every page is precisely what the " +
        "client's own matcher would keep, so a page is never missing records it should hold.",
    ),
  /**
   * Scope the page to records whose `date`/`created_time`/`updated_time` field
   * falls in `[gte, lt)` — an absolute UTC instant range, not a `filters`
   * condition. It is deliberately NOT an operator on `listRecordsFilterSchema`:
   * that model mirrors the client's label-based view-filter matching (see
   * `recordMatchesViewFilter`), which for a date renders via
   * `toLocaleDateString()` — meaningless without knowing the viewer's
   * timezone, which the server never has. A UTC instant range has no such
   * ambiguity, so it is resolved once here, by the caller (who DOES know the
   * viewer's timezone), and applied as a real timestamp comparison.
   *
   * The motivating case is a Calendar month grid: the client computes the UTC
   * bounds of its own local 42-day grid and asks for only that slice, instead
   * of every record in the Base.
   */
  dateRange: z
    .object({
      fieldSlug: z.string().min(1),
      gte: z.string().describe("Inclusive lower bound, ISO 8601 UTC instant."),
      lt: z.string().describe("EXCLUSIVE upper bound, ISO 8601 UTC instant."),
    })
    .optional()
    .describe(
      "Scope the page to a `date`/`created_time`/`updated_time` field falling in `[gte, lt)` — " +
        "a half-open range of absolute UTC instants, not a `filters` condition. Resolve the " +
        "bounds yourself: a day or a month only means something in a timezone, and the server " +
        "does not know the viewer's.",
    ),
  page: z.coerce.number().int().min(1).optional().default(1).describe("1-indexed, not 0-indexed."),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe("Records per page. Capped at 100."),
});

export const listRecordsPageResponseSchema = z.object({
  records: z.array(recordSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

const countRecordsShapeSchema = z
  .object({
    baseId: z
      .string()
      .optional()
      .describe(
        "Restrict to one Base. Omitting it counts every record in the space. " +
          "Required as soon as `viewId`, `filters` or `valueFilters` is given — a field slug " +
          "only means something within one Base.",
      ),
    viewId: z
      .string()
      .optional()
      .describe(
        "Count only what this saved View would display. Its filters apply; its sort is ignored, " +
          "since a count has no order. Requires `baseId`.",
      ),
    /**
     * Ad-hoc filter conditions — same shape `records.list`'s `filters` uses —
     * for composing a condition set without a saved View (e.g. an AirApp
     * summary tile like "main-branch PRs"). Combined with the View's own
     * filters (AND) when `viewId` is also given. Requires `baseId`: a field
     * slug is only unambiguous within one Base, and proving a filter exact
     * (see `countRecords`) requires that Base's real field definitions —
     * never the caller-supplied `fieldType` hint, which elsewhere is only a
     * pushdown hint and isn't trustworthy enough for an exact count.
     */
    filters: z
      .array(listRecordsFilterSchema)
      .optional()
      .describe(
        "Ad-hoc conditions, ANDed with the View's own when `viewId` is also given. Unlike " +
          "`records.list`'s superset `filters`, the COUNT is exact either way — but a condition " +
          "whose exactness cannot be proven makes the server read every candidate row instead " +
          "of running one aggregate, so prefer `valueFilters` where it fits. Requires `baseId`.",
      ),
    /**
     * Exact value comparisons, same shape and meaning as `records.list`'s.
     *
     * Worth having here specifically because they are ALWAYS exact: a count
     * scoped only by these stays a single SQL `count(*)`, where an ad-hoc view
     * `filters` set that cannot be proven exact falls back to reading every
     * candidate row and counting the survivors. Requires `baseId` for the same
     * reason `filters` does — a field slug is only unambiguous within one Base.
     */
    valueFilters: z
      .array(listRecordsValueFilterNodeSchema)
      .optional()
      .describe(
        "EXACT value comparisons, same shape as `records.list`'s. Always exact, so a count scoped " +
          "only by these stays a single SQL count instead of reading every candidate row. " +
          "Requires `baseId`.",
      ),
  })
  .superRefine((value, ctx) => {
    if (value.valueFilters?.length && !value.baseId) {
      ctx.addIssue({
        code: "custom",
        path: ["baseId"],
        message: "baseId is required when valueFilters is given",
      });
    }
    if (value.viewId && !value.baseId) {
      ctx.addIssue({
        code: "custom",
        path: ["baseId"],
        message: "baseId is required when viewId is given",
      });
    }
    if (value.filters?.length && !value.baseId) {
      ctx.addIssue({
        code: "custom",
        path: ["baseId"],
        message: "baseId is required when filters is given",
      });
    }
  });

export const countRecordsInputSchema = countRecordsShapeSchema.optional().default({});

export const countRecordsResponseSchema = z.object({
  /** Total active records in the space (optionally scoped to a base). */
  total: z.number().int().nonnegative(),
});

/**
 * A numeric aggregate over the records in a group.
 *
 * Exact for the same reason `valueFilters` are: `value_number` holds the value
 * itself, so `sum`/`avg`/`min`/`max` are ordinary SQL over a real column with
 * no formatting layer to diverge from. Restricted to number-shaped fields for
 * exactly that reason — there is no column to add up on the others.
 *
 * `count` here counts rows whose value is PRESENT, which is not the same as the
 * group's `count` (that one counts records, present value or not). Both are
 * useful and SQL distinguishes them, so both are available.
 */
export const recordAggregateSchema = z.object({
  fn: z.enum(["sum", "avg", "min", "max", "count"]),
  fieldSlug: z.string().min(1),
});

export const groupRecordsInputSchema = z.object({
  baseId: z.string().min(1).describe("Required: a field slug is only unambiguous within one Base."),
  /**
   * The field to group by. Restricted to `select` and `checkbox`: their stored
   * value IS the grouping key (a choice id / a boolean), so a SQL GROUP BY
   * returns exactly the buckets a client would build. Text/number keys would
   * be truncated at the projection limit, and date keys would bucket by the
   * server's timezone rather than the viewer's — both would report a
   * confidently wrong split, so they're rejected instead of approximated.
   *
   * OMIT it to aggregate the whole filtered set as a single bucket. That is the
   * shape a summary tile wants ("total pipeline value"), and it costs one query
   * instead of reading every record to add them up client-side.
   */
  fieldSlug: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The field to group by. OMIT it to aggregate the whole filtered set as a single bucket, " +
        "which is what a summary tile wants. Under the default `grid` bucketing only `select` and " +
        "`checkbox` can be grouped; `sql` bucketing also allows number and date fields.",
    ),
  /**
   * Which bucketing rules to use, and they genuinely differ.
   *
   * `grid` (the default, and what this endpoint has always done) buckets the
   * way the GRID renders: an unset checkbox folds in with `false`, and an empty
   * string folds into the null bucket. That is right for a Kanban column header
   * — a card with no value belongs under "false", not in a fourth column.
   *
   * `sql` buckets the way `GROUP BY` does: a missing value gets its OWN bucket
   * and nothing is folded. That is right for a caller reproducing SQL — an ORM
   * driver, or anything comparing this against a database — and it is what lets
   * such a caller trust the server's answer instead of re-grouping locally.
   *
   * The two disagree on real data, which is why this is a choice rather than a
   * fix: neither is a better version of the other.
   */
  bucketing: z
    .enum(["grid", "sql"])
    .optional()
    .default("grid")
    .describe(
      "How records are bucketed, and the two modes disagree on real data. " +
        "`grid` (default) buckets the way the grid renders: an unset checkbox counts as `false` " +
        "and an empty string falls in the null bucket — right for a Kanban column header. " +
        "`sql` buckets the way GROUP BY does: a missing value gets its OWN bucket and nothing is " +
        "folded — right for anything reproducing SQL. `sql` also returns keys in their own type " +
        "(a number for a number field) rather than as strings.",
    ),
  /**
   * Numeric aggregates evaluated per group, keyed in the response as
   * `"<fn>:<fieldSlug>"`. Without this the response is counts only, exactly as
   * before.
   */
  aggregates: z
    .array(recordAggregateSchema)
    .optional()
    .describe(
      'Numeric aggregates evaluated per group, keyed in the response as `"<fn>:<fieldSlug>"`. ' +
        "Only number-shaped fields can be aggregated; anything else is a 400. " +
        "`sum`/`avg`/`min`/`max` of a group holding no values are NULL rather than 0, and `count` " +
        "over a FIELD counts present values — which is not the same as the group's own `count`, " +
        "which counts records.",
    ),
  viewId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Group only what this saved View would display. Its filters apply; its sort is ignored.",
    ),
  filters: z
    .array(listRecordsFilterSchema)
    .optional()
    .describe(
      "Ad-hoc conditions, ANDed with the View's own when both are given. The grouping is exact " +
        "either way, but a condition whose exactness cannot be proven makes the server read " +
        "every candidate row instead of running one GROUP BY.",
    ),
  /**
   * Exact value comparisons, ANDed with everything above. Always exact, so a
   * grouping scoped only by these stays a single SQL GROUP BY.
   */
  valueFilters: z
    .array(listRecordsValueFilterNodeSchema)
    .optional()
    .describe(
      "EXACT value comparisons, same shape as `records.list`'s. Always exact, so a grouping " +
        "scoped only by these stays a single SQL GROUP BY.",
    ),
});

export const groupRecordsResponseSchema = z.object({
  groups: z.array(
    z.object({
      /**
       * The raw stored key.
       *
       * Under `grid` bucketing (the default) this is always a string or null: a
       * `select` choice id, or `"true"`/`"false"` for a checkbox, where `null`
       * is the bucket of records with no value (a Kanban board's
       * "Uncategorized" column) and an unset checkbox counts as `"false"`.
       *
       * Under `sql` bucketing it is the STORED value in its own type — a number
       * for a number field, a boolean for a checkbox, an ISO string for a date
       * — and `null` means the record has no value for that field, which under
       * these rules is a bucket of its own rather than folded into another.
       *
       * Choice LABELS are deliberately not resolved here — the client already
       * holds the Base's field definitions and renders labels itself, and
       * returning ids keeps this response stable across a choice rename.
       */
      value: z
        .union([z.string(), z.number(), z.boolean()])
        .nullable()
        .describe(
          "The bucket key. Under `grid` bucketing always a string or null (a select's choice, or " +
            '`"true"`/`"false"` for a checkbox, with null meaning "no value"). Under `sql` ' +
            "bucketing it is the stored value in its own type, and null is the bucket of records " +
            "that have no value for the field.",
        ),
      count: z.number().int().nonnegative().describe("Records in this bucket."),
      /**
       * Present only when `aggregates` was requested. Keyed `"<fn>:<fieldSlug>"`.
       * A value of `null` means the group held no rows with that field set —
       * which is NOT the same as `0`, and a dashboard renders them differently.
       */
      aggregates: z
        .record(z.string(), z.number().nullable())
        .optional()
        .describe(
          'Present only when `aggregates` was requested, keyed `"<fn>:<fieldSlug>"`. ' +
            "A null value means the bucket held no records with that field set — not zero.",
        ),
    }),
  ),
  /** Sum of every group's count — the same number `records.count` would return. */
  total: z.number().int().nonnegative(),
});

export const createChangeRequestInputSchema = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .describe(
      "Record field values keyed by field slug. The base's PRIMARY field (its first field) becomes the record's display name and the change request title everywhere — always give it a short, human-readable value, never an id or placeholder.",
    ),
  message: z
    .string()
    .optional()
    .default("Initial change request")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Add Acme Corp — qualified lead from the June webinar".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "Optional client-supplied key that dedupes retries. Scoped per base + submitter: calling this endpoint again with the SAME idempotencyKey (e.g. after a timeout or a 5xx where you couldn't tell if the first call succeeded) returns the change request created by the first call instead of creating a duplicate. Omit for normal one-shot calls; only set it when you might retry.",
    ),
  // Permission-aware default: omitted merges immediately if the actor has
  // write access on the Base's node, otherwise falls back to a pending
  // ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to
  // force review even with write access; `autoMerge: true` approves and
  // merges right away, returning the materialized record instead of the
  // pending ChangeRequest (gracefully falls back to a pending CR if the
  // actor doesn't actually have write access).
  autoMerge: z.boolean().optional(),
});

export const createBulkChangeRequestInputSchema = z.object({
  records: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(1000)
    .describe(
      "Field-value maps, one per record to create, each keyed by field slug. All records are proposed as a SINGLE change request (one review, one merge) — use this to import/seed many rows at once instead of one change request per record. Capped at 1000; for very large loads prefer a dedicated import job. Always give each record's PRIMARY field a short human-readable value.",
    ),
  message: z
    .string()
    .optional()
    .default("Bulk create records")
    .describe(
      'Explanation shown to the human reviewer for the whole batch — e.g. "Import 240 June webinar leads".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "Optional client-supplied key that dedupes retries. Scoped per base + submitter: calling this endpoint again with the SAME idempotencyKey returns the bulk change request created by the first call instead of creating a duplicate. Omit for normal one-shot calls; only set it when you might retry.",
    ),
  // Same permission-aware tri-state as the single-record endpoint above. N record
  // CREATES are purely additive, so there is nothing here the review gate is
  // protecting — and until now the published skill doc told agents to send N
  // separate single-record calls precisely because this one could not merge,
  // which is slower and produces N change requests instead of one.
  autoMerge: z.boolean().optional(),
});

const bulkRecordUpdateSchema = z.object({
  recordId: z.string().min(1),
  fields: z
    .record(z.string(), z.unknown())
    .refine((fields) => Object.keys(fields).length > 0, "fields must contain at least one field"),
  baseCommitId: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});

export const createBulkUpdateChangeRequestInputSchema = z
  .object({
    updates: z.array(bulkRecordUpdateSchema).min(1).max(1000),
    message: z.string().optional().default("Bulk update records"),
    submittedBy: z.string().optional().default("local-producer"),
    idempotencyKey: z.string().optional(),
    autoMerge: z.boolean().optional(),
  })
  .superRefine(({ updates }, ctx) => {
    const seen = new Set<string>();
    for (const [index, update] of updates.entries()) {
      if (seen.has(update.recordId)) {
        ctx.addIssue({
          code: "custom",
          path: ["updates", index, "recordId"],
          message: `Duplicate recordId in batch: ${update.recordId}`,
        });
      }
      seen.add(update.recordId);
    }
  });

export const recordFieldFilterInputSchema = z.object({
  baseId: z
    .string()
    .optional()
    .describe("Restrict to one Base. Omitting it searches the whole space."),
  fieldSlug: z
    .string()
    .min(1)
    .describe("The field's SLUG, not its display name — visible in the Base's field settings."),
  valueText: z
    .string()
    .min(1)
    .describe(
      "Matched by EXACT equality, not substring or fuzzy — this is the de-dup-by-key lookup. " +
        "Use `/api/v1/search` for full-text.",
    ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50)
    .describe("Maximum matches to return. Capped at 100."),
});

export const recordFieldGetInputSchema = z.object({
  baseId: z.string().describe("Field selector: Base id. Requires fieldSlug and valueText."),
  fieldSlug: z
    .string()
    .min(1)
    .describe("Field selector: exact field slug. Requires baseId and valueText."),
  valueText: z
    .string()
    .min(1)
    .describe("Field selector: exact text value. Requires baseId and fieldSlug."),
});

/**
 * A record get is always a single-row lookup, addressed either by its canonical
 * id or by one exact field value within a Base. Strict branches make this a
 * real XOR at runtime: callers cannot send both selector shapes and have Zod
 * silently discard the extra keys.
 */
export const recordGetInputSchema = z.union([
  z
    .object({
      recordId: z
        .string()
        .min(1)
        .describe("Record id selector. Use alone; do not combine with field selector fields."),
    })
    .strict(),
  recordFieldGetInputSchema.strict(),
]);

export const restoreRecordInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: destructiveAutoMerge(
    'Restoring is itself the undo of an archive, and is undone again by `operation: "delete"`.',
  ),
});

/**
 * Every record change request in one shape. These three used to be PUT, DELETE,
 * and a POST on a `/restore/` sub-path — three endpoints addressing the same
 * record and returning the same change request, differing only in payload.
 */
// `recordId` (the path param) is repeated into every branch for the same reason
// `baseId` is in `fieldChangeRequestInputSchema` — see the note there.
const withRecordId = { recordId: z.string().min(1) };

export const recordChangeRequestInputSchema = z.discriminatedUnion("operation", [
  reviseOperationInputSchema.extend({
    operation: z.literal("update"),
    autoMerge: z.boolean().optional(),
    ...withRecordId,
  }),
  createDeleteChangeRequestInputSchema.extend({ operation: z.literal("delete"), ...withRecordId }),
  restoreRecordInputSchema.extend({ operation: z.literal("restore"), ...withRecordId }),
]);

export const recordLinkSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  fieldId: z.string(),
  fieldSlug: z.string(),
  sourceRecordId: z.string(),
  targetBaseId: z.string(),
  targetRecordId: z.string(),
  commitId: z.string(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
