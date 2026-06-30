import { z } from "zod";

// Base-owned view Zod schemas. Pure leaf: no kernel imports.

export const viewFilterOperatorSchema = z.enum([
  "contains",
  "equals",
  "not_empty",
  "is_empty",
  "is_true",
  "is_false",
]);

export const viewFilterSchema = z.object({
  fieldSlug: z.string(),
  // Stable field identity — survives slug reuse; populated on merge.
  fieldId: z.string().optional(),
  operator: viewFilterOperatorSchema,
  value: z.unknown().optional(),
});

export const viewSortSchema = z.object({
  direction: z.enum(["asc", "desc"]),
  fieldSlug: z.string(),
  fieldId: z.string().optional(),
});

export const viewConfigSchema = z.object({
  filters: z.array(viewFilterSchema).default([]),
  sorts: z.array(viewSortSchema).default([]),
  visibleFieldSlugs: z.array(z.string()).nullable().optional(),
});

export const viewSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.literal("table"),
  config: viewConfigSchema,
  status: z.enum(["active", "archived"]),
  createdBy: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createViewInputSchema = z.object({
  config: viewConfigSchema.optional().default({ filters: [], sorts: [] }),
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
