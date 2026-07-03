import { CREATABLE_NODE_TYPES } from "busabase-contract/domains";
import { fieldNameSchema } from "busabase-contract/domains/base/contract/base-schemas";
import { z } from "zod";

const fieldTypeSchema = z.enum([
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

const fieldOptionsSchema = z
  .object({
    ai: z
      .object({
        model: z.string().optional(),
        prompt: z.string().optional(),
        reviewRequired: z.boolean().optional(),
        sourceFieldIds: z.array(z.string()).optional(),
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

export const fieldSchema = z.object({
  slug: z.string().min(1),
  name: fieldNameSchema,
  type: fieldTypeSchema.default("text"),
  required: z.boolean().default(false),
  options: fieldOptionsSchema.optional().default({}),
});

export const createBaseInputSchema = z.object({
  parentNodeId: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  fields: z.array(fieldSchema).default([]),
});

const nodeOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    parentNodeId: z.string().optional(),
    nodeType: z.enum(CREATABLE_NODE_TYPES),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().optional().default(""),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    fields: z
      .array(
        z.object({
          slug: z
            .string()
            .min(1)
            .regex(/^[a-z0-9-]+$/),
          name: fieldNameSchema,
          type: fieldTypeSchema.default("text"),
          required: z.boolean().optional().default(false),
          options: fieldOptionsSchema.optional().default({}),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal("rename"),
    nodeId: z.string(),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  z.object({
    kind: z.literal("delete"),
    nodeId: z.string(),
  }),
  z.object({
    kind: z.literal("move"),
    nodeId: z.string(),
    parentNodeId: z.string(),
    position: z.number().int().optional(),
  }),
]);

export const createNodeChangeRequestInputSchema = z.object({
  message: z.string().optional().default("Update node tree"),
  submittedBy: z.string().optional().default("local-producer"),
  operations: z.array(nodeOperationInputSchema).min(1),
});

const viewFilterOperatorSchema = z.enum([
  "contains",
  "equals",
  "not_empty",
  "is_empty",
  "is_true",
  "is_false",
]);

const viewFilterSchema = z.object({
  fieldSlug: z.string().min(1),
  operator: viewFilterOperatorSchema,
  value: z.unknown().optional(),
});

const viewSortSchema = z.object({
  direction: z.enum(["asc", "desc"]),
  fieldSlug: z.string().min(1),
});

export const viewConfigSchema = z
  .object({
    filters: z.array(viewFilterSchema).optional().default([]),
    sorts: z.array(viewSortSchema).optional().default([]),
    visibleFieldSlugs: z.array(z.string()).nullable().optional(),
  })
  .optional()
  .default({ filters: [], sorts: [] });

export const createViewInputSchema = z.object({
  config: viewConfigSchema,
  description: z.string().optional().default(""),
  message: z.string().optional().default("Create view"),
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  submittedBy: z.string().optional().default("local-producer"),
});

export const updateViewInputSchema = z.object({
  config: viewConfigSchema.optional(),
  description: z.string().optional(),
  message: z.string().optional().default("Update view"),
  name: z.string().min(1).optional(),
  submittedBy: z.string().optional().default("local-producer"),
});

export const deleteViewInputSchema = z.object({
  message: z.string().optional().default("Delete view"),
  submittedBy: z.string().optional().default("local-producer"),
});

export const restoreViewInputSchema = z.object({
  message: z.string().optional().default("Restore view"),
  submittedBy: z.string().optional().default("local-producer"),
});

export const createChangeRequestInputSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Initial changeRequest"),
  submittedBy: z.string().optional().default("local-producer"),
});

export const createDeleteChangeRequestInputSchema = z.object({
  message: z.string().optional().default("Delete record"),
  submittedBy: z.string().optional().default("local-producer"),
  // Only "archive" is supported — hard delete after retention was never
  // implemented, so the API no longer accepts it (breaking change).
  deleteMode: z.enum(["archive"]).optional().default("archive"),
});

export const reviseOperationInputSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  message: z.string().optional().default("Revise operation"),
  author: z.string().optional().default("local-producer"),
  baseCommitId: z.string().optional(),
});

export const recordFieldFilterInputSchema = z.object({
  baseId: z.string().optional(),
  fieldSlug: z.string().min(1),
  valueText: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional().default(50),
});
