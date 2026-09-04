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

export const listRecordsInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    baseId: z.string().optional(),
    /** Opaque base64 cursor for keyset pagination (createdAt-keyed, or sort-keyed when `sort` is set). */
    cursor: z.string().optional(),
    /**
     * `active` (default) is the live table; `archived` is the Base's trash — the
     * same keyset pagination either way, which is why these are one endpoint
     * rather than a `/records/archived` twin.
     */
    status: z.enum(["active", "archived"]).optional().default("active"),
    /** View filters for server-side push-down (superset; client still narrows). */
    filters: z.array(listRecordsFilterSchema).optional(),
    /** View sort for server-side push-down (number/date fields only). */
    sort: listRecordsSortSchema.optional(),
  })
  .optional()
  .default({ limit: 50, status: "active" });

export const listRecordsResponseSchema = z.object({
  records: z.array(recordSchema),
  nextCursor: z.string().nullable(),
});

export const listRecordsPageInputSchema = z.object({
  baseId: z.string().min(1),
  viewId: z.string().min(1).optional(),
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
  filters: z.array(listRecordsFilterSchema).optional(),
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
      /** Inclusive lower bound, ISO 8601 UTC instant. */
      gte: z.string(),
      /** Exclusive upper bound, ISO 8601 UTC instant. */
      lt: z.string(),
    })
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
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
    baseId: z.string().optional(),
    /**
     * Count only the rows a saved View would display (the View's filters
     * applied; its sort is ignored — a count doesn't need an order). A View
     * belongs to exactly one Base, so this requires `baseId`.
     */
    viewId: z.string().optional(),
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
    filters: z.array(listRecordsFilterSchema).optional(),
  })
  .superRefine((value, ctx) => {
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

export const groupRecordsInputSchema = z.object({
  /** Group within exactly one Base — a field slug is only unambiguous there. */
  baseId: z.string().min(1),
  /**
   * The field to group by. Restricted to `select` and `checkbox`: their stored
   * value IS the grouping key (a choice id / a boolean), so a SQL GROUP BY
   * returns exactly the buckets a client would build. Text/number keys would
   * be truncated at the projection limit, and date keys would bucket by the
   * server's timezone rather than the viewer's — both would report a
   * confidently wrong split, so they're rejected instead of approximated.
   */
  fieldSlug: z.string().min(1),
  /** Group only the rows a saved View would display (its filters; sort ignored). */
  viewId: z.string().min(1).optional(),
  /** Ad-hoc filters, ANDed with the View's own when both are given. */
  filters: z.array(listRecordsFilterSchema).optional(),
});

export const groupRecordsResponseSchema = z.object({
  groups: z.array(
    z.object({
      /**
       * The raw stored key: a `select` choice id, or `"true"`/`"false"` for a
       * checkbox. For a select, `null` is the bucket of records with no value
       * (what a Kanban board shows as its "Uncategorized" column). A checkbox
       * never reports `null` — an unset checkbox counts as `"false"`, matching
       * how view filters already treat it (`is_false` covers null/undefined).
       *
       * Choice LABELS are deliberately not resolved here — the client already
       * holds the Base's field definitions and renders labels itself, and
       * returning ids keeps this response stable across a choice rename.
       */
      value: z.string().nullable(),
      count: z.number().int().nonnegative(),
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
  baseId: z.string().optional(),
  fieldSlug: z.string().min(1),
  valueText: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
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
