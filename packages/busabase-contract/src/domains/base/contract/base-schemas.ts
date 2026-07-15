import { iStringRecordSchema } from "openlib/i18n/i-string";
import { z } from "zod";

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
]);

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
    inverseFieldId: z.string().optional(),
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
  // Review-first by default: without `autoMerge: true`, this proposes the Base
  // as a pending ChangeRequest (status "in_review") instead of creating it
  // immediately. Pass `autoMerge: true` only for callers that don't need human
  // review (seed/migration scripts, an explicit no-review agent task).
  autoMerge: z.boolean().optional().default(false),
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

export const createFieldChangeRequestInputSchema = createBaseFieldInputSchema.extend({
  message: z.string().optional().default("Add field"),
  submittedBy: z.string().optional().default("local-editor"),
});

export const deleteFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
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
});

export const reorderFieldsChangeRequestInputSchema = z.object({
  fieldIds: z.array(z.string()).min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
});

export const archiveBaseInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
});

export const restoreBaseInputSchema = z.object({
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
});

export const restoreFieldChangeRequestInputSchema = z.object({
  fieldId: z.string().min(1),
  message: z.string().optional(),
  submittedBy: z.string().optional().default("local-editor"),
});
