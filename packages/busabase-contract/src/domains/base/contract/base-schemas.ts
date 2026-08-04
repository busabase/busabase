import { iStringRecordSchema } from "openlib/i18n/i-string";
import { z } from "zod";
import { autoMergeNotAccepted } from "../../../contract/auto-merge";

// Base-owned field + base Zod schemas. Pure leaf: imports nothing from the kernel
// contract, so the kernel can embed `baseSchema` eagerly with no import cycle.
// (openlib/i18n/i-string is zod-only — safe for the client bundle.)

// Field display names are iStrings: a plain string or a locale-keyed record like
// { en: "Company", "zh-CN": "公司" }. Slugs stay the stable identifier; the name is
// display-only. A record must carry at least one non-empty value.
export const fieldNameSchema = z.union([
  z.string().min(1),
  iStringRecordSchema.refine(
    (record) => Object.values(record).some((value) => value && value.trim().length > 0),
    "field name must have at least one non-empty locale value",
  ),
]);

export const fieldTypeSchema = z.enum([
  "text",
  "longtext",
  "markdown",
  "html",
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "embed",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  "ai_summary",
  "ai_tags",
  "code",
  "json",
  "yaml",
  "formula",
  "lookup",
  "whiteboard",
]);

/**
 * Rollup functions a `lookup` field can apply to the values it pulls across a
 * relation. `values` is the plain lookup (bring the linked records' values over
 * as-is); everything else aggregates them into a single scalar.
 *
 * Deliberately narrower than Airtable/Vika's ~15 — every entry here is actually
 * implemented. A rollup that would silently degrade to a raw array is worse than
 * one that was never offered.
 */
export const lookupRollupSchema = z
  .enum(["values", "count", "sum", "average", "min", "max", "concatenate"])
  .default("values");

export const fieldOptionsSchema = z
  .object({
    ai: z
      .object({
        model: z.string().optional(),
        prompt: z.string().optional(),
        reviewRequired: z.boolean().optional(),
        sourceFieldIds: z.array(z.string()).optional(),
      })
      .optional(),
    // Per-field config for `attachment` columns (all optional; logic enforces a
    // 25MB ceiling regardless).
    attachment: z
      .object({
        maxFiles: z.number().int().positive().optional(),
        allowedMimeTypes: z.array(z.string()).optional(),
        maxFileSize: z.number().int().positive().optional(),
      })
      .optional(),
    choices: z
      .array(
        z.object({
          color: z.string().optional(),
          id: z.string(),
          name: z.string(),
        }),
      )
      .optional(),
    code: z
      .object({
        language: z.string().optional(),
      })
      .optional(),
    embed: z
      .object({
        aspectRatio: z.enum(["16:9", "4:3", "1:1"]).optional(),
        height: z.number().int().positive().max(1200).optional(),
        providers: z.array(z.string()).optional(),
      })
      .optional(),
    // `formula` fields are server-computed (like the other computed types) from
    // `expression` at record write time — see packages/busabase-core's
    // domains/base/formula/ engine. `{slug}` references a sibling field, including
    // another `formula` field (chained formulas) — a dependency graph orders
    // computation and rejects cycles at field create/edit time.
    formula: z
      .object({
        expression: z.string().min(1),
      })
      .optional(),
    inverseFieldId: z.string().optional(),
    // `lookup` fields pull a field's values across a `relation` field on the same
    // Base, optionally rolling them up into one scalar. Unlike every other computed
    // type they are NOT stored on the commit: a lookup's value depends on OTHER
    // records, which can change without this record ever being written, so it is
    // resolved at read time (see busabase-core's domains/base/logic/lookup-values.ts).
    lookup: z
      .object({
        relationFieldSlug: z
          .string()
          .min(1)
          .describe("Slug of a `relation` field on THIS Base — the hop to follow."),
        targetFieldSlug: z
          .string()
          .min(1)
          .describe("Slug of the field on the related Base whose values are pulled over."),
        rollup: lookupRollupSchema.optional(),
        limit: z
          .enum(["all", "first"])
          .optional()
          .describe("`first` looks at only the first linked record; default `all`."),
      })
      .optional(),
    multiple: z.boolean().optional(),
    // Display formatting for `number` columns (Notion-style: one number type,
    // a format option). `currency` renders via Intl.NumberFormat.
    number: z
      .object({
        format: z.enum(["plain", "currency"]).optional(),
        currency: z.string().optional(),
        locale: z.string().optional(),
      })
      .optional(),
    targetBaseId: z
      .string()
      .optional()
      .describe("Relation target Base id (bse_…). Or pass targetBaseSlug to name it by slug."),
    targetBaseSlug: z
      .string()
      .optional()
      .describe(
        "Relation target Base by slug — a convenience alias for targetBaseId, resolved server-side (active bases in the current space). If both are given, targetBaseId wins.",
      ),
  })
  .default({});

export const baseFieldSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  slug: z.string(),
  name: fieldNameSchema,
  type: fieldTypeSchema,
  required: z.boolean(),
  position: z.number(),
  options: fieldOptionsSchema,
});

export const baseSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  reviewPolicy: z.object({
    kind: z.literal("single"),
    requiredApprovals: z.number(),
  }),
  createdAt: z.string(),
  fields: z.array(baseFieldSchema),
});

export const createBaseInputSchema = z.object({
  parentNodeId: z
    .string()
    .optional()
    .describe(
      "Parent node id. Must be a folder or the space root; container-incapable node types (Base, Doc, AirApp, etc.) cannot hold children.",
    ),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  fields: z
    .array(
      z.object({
        slug: z.string().min(1),
        name: fieldNameSchema,
        type: fieldTypeSchema.default("text"),
        required: z.boolean().default(false),
        options: fieldOptionsSchema.optional().default({}),
      }),
    )
    .default([]),
  // Permission-aware default: omitted merges immediately if the actor has
  // write access on the parent node, otherwise falls back to a pending
  // ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to
  // force review even with write access.
  autoMerge: z.boolean().optional(),
});

export const createBaseFieldInputSchema = z.object({
  name: fieldNameSchema,
  // Field slugs are snake_case identifiers (e.g. `cover_image`, `publish_date`) — the
  // seed and the inline-fields path on `POST /bases` already allow underscores, so the
  // add-field endpoint must too. (Base/folder/view slugs stay kebab-case: they go in URLs.)
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/),
  type: fieldTypeSchema.default("text"),
  required: z.boolean().optional().default(false),
  options: fieldOptionsSchema.optional().default({}),
});

/**
 * Permission-aware default, same tri-state as `createBase` / the record and view
 * endpoints: omitted merges immediately when the actor has `write` on the Base's
 * node, otherwise falls back to a pending ChangeRequest. Explicit `false` forces
 * review even with write access.
 *
 * Deliberately NOT on the `delete` and `convert` branches below. The line this
 * codebase already draws — record `update` auto-merges, record `delete`/`restore`
 * never do, and `assets.editContent` never does — is about whether CONTENT data
 * is at stake, not about the verb. Adding, renaming, reordering, or un-deleting a
 * field touches only the schema; deleting one soft-deletes its stored values with
 * it, and converting one can drop values outright (which is why
 * `previewFieldConversion` exists as a dry run). Those two stay in front of a
 * human.
 */
const fieldAutoMergeSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether to approve and merge this field change immediately. Omitted defaults to merging immediately if the actor has write access on the Base's node, otherwise falling back to a pending Change Request; pass explicit false to force review even with write access. Not accepted by the delete and convert operations, which always require review.",
  );

export const createFieldChangeRequestInputSchema = createBaseFieldInputSchema.extend({
  message: z.string().optional().default("Add field"),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: fieldAutoMergeSchema,
});

export const deleteFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: autoMergeNotAccepted(
    "deleting a field soft-deletes its stored values with it, so it always requires review. Omit the flag.",
  ),
});

export const updateFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  patch: z.object({
    name: fieldNameSchema.optional(),
    required: z.boolean().optional(),
    options: fieldOptionsSchema.optional(),
  }),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: fieldAutoMergeSchema,
});

export const previewFieldConversionInputSchema = z.object({
  fieldId: z.string().min(1),
  newType: fieldTypeSchema,
});

export const previewFieldConversionOutputSchema = z.object({
  totalCount: z.number(),
  convertibleCount: z.number(),
  nullCount: z.number(),
  conflicts: z.array(z.object({ recordId: z.string(), currentValue: z.unknown() })),
});

export const convertFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  newType: fieldTypeSchema,
  selectChoiceMode: z.enum(["auto_create", "null_on_missing"]).default("null_on_missing"),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: autoMergeNotAccepted(
    "converting a field's type can drop values, so it always requires review. Run previewFieldConversion first to see what would change, then omit the flag.",
  ),
});

export const reorderFieldsChangeRequestInputSchema = z.object({
  fieldIds: z.array(z.string()).min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: fieldAutoMergeSchema,
});

export const archiveBaseInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: autoMergeNotAccepted(
    "archiving a Base removes it and every record in it from every listing at once, so it always requires review. Omit the flag.",
  ),
});

export const restoreBaseInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  // Restoring an archived Base is the undo of a destructive act — nothing is at
  // risk, so it takes the same permission-aware default as everything else.
  // `archiveBaseInputSchema` above deliberately has no `autoMerge`: archiving
  // takes a whole Base and every record in it out of every listing at once,
  // which is strictly larger than the record `delete` that is already review-only.
  autoMerge: z.boolean().optional(),
});

export const restoreFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
  autoMerge: fieldAutoMergeSchema,
});

/**
 * Every field change request in one shape. These six used to be six endpoints
 * that differed only by the verb in the middle of the path (or, for two of
 * them, only by HTTP method on an identical path) — same `baseId`, same
 * `changeRequest` response, same review workflow. The variation is entirely in
 * the payload, which is what a discriminated union is for.
 */
// `baseId` (the path param) is repeated into every branch rather than added with
// `.and(z.object({ baseId }))`: an intersection serializes to JSON Schema `allOf`,
// which leaves the MCP tool with neither `properties` nor `anyOf` — i.e. an agent
// sees a tool with no documented inputs at all.
const withBaseId = { baseId: z.string().min(1) };

export const fieldChangeRequestInputSchema = z.discriminatedUnion("operation", [
  createFieldChangeRequestInputSchema.extend({ operation: z.literal("create"), ...withBaseId }),
  updateFieldChangeRequestInputSchema.extend({ operation: z.literal("update"), ...withBaseId }),
  deleteFieldChangeRequestInputSchema.extend({ operation: z.literal("delete"), ...withBaseId }),
  convertFieldChangeRequestInputSchema.extend({ operation: z.literal("convert"), ...withBaseId }),
  reorderFieldsChangeRequestInputSchema.extend({ operation: z.literal("reorder"), ...withBaseId }),
  restoreFieldChangeRequestInputSchema.extend({ operation: z.literal("restore"), ...withBaseId }),
]);

/**
 * Moving a Base between its lifecycle states, in one shape. Archive and restore
 * used to be two endpoints whose only difference was the verb in the middle of
 * the path — byte-identical payloads, the same `changeRequest` response, the
 * same API-key level. The variation is which direction the Base is moving,
 * which is what the discriminant carries.
 */
export const baseLifecycleChangeRequestInputSchema = z.discriminatedUnion("operation", [
  archiveBaseInputSchema.extend({ operation: z.literal("archive"), ...withBaseId }),
  restoreBaseInputSchema.extend({ operation: z.literal("restore"), ...withBaseId }),
]);
