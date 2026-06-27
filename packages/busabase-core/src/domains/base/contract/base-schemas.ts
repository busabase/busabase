import { z } from "zod";

// Base-owned field + base Zod schemas. Pure leaf: imports nothing from the kernel
// contract, so the kernel can embed `baseSchema` eagerly with no import cycle.

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
    targetBaseId: z.string().optional(),
  })
  .default({});

export const baseFieldSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  slug: z.string(),
  name: z.string(),
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
  parentNodeId: z.string().optional(),
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
        name: z.string().min(1),
        type: fieldTypeSchema.default("text"),
        required: z.boolean().default(false),
        options: fieldOptionsSchema.optional().default({}),
      }),
    )
    .min(1),
});

export const createBaseFieldInputSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  type: fieldTypeSchema.default("text"),
  required: z.boolean().optional().default(false),
  options: fieldOptionsSchema.optional().default({}),
});

export const createFieldChangeRequestInputSchema = createBaseFieldInputSchema.extend({
  message: z.string().optional().default("Add field"),
  submittedBy: z.string().optional().default("local-editor"),
});
