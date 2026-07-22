import { z } from "zod";
import { userRefSchema } from "../../../contract/schemas";
import { VIEW_FIELD_MAX_WIDTH, VIEW_FIELD_MIN_WIDTH } from "../types";

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

// Supported view types. `table` is the classic grid; `gallery` renders records
// as a responsive card wall with an attachment-image cover; `kanban` stacks
// records into columns by a select field (drag to change); `calendar` places
// records on a month grid by a date field. New view kinds only add an enum
// member here — the model is unchanged.
export const viewTypeSchema = z.enum(["table", "gallery", "kanban", "calendar", "gantt"]);
export type ViewType = z.infer<typeof viewTypeSchema>;

// Gantt time-axis granularity.
export const ganttScaleSchema = z.enum(["week", "month"]);

// How a gallery cover image fills its fixed-aspect area.
// `cover` = CSS object-fit: cover (crop to fill); `fit` = contain (letterbox).
export const galleryCoverFitSchema = z.enum(["cover", "fit"]);

// Card size presets —列数由 CSS 响应式回流决定，不做自由拖拽尺寸。
export const galleryCardSizeSchema = z.enum(["small", "medium", "large"]);

export const viewConfigSchema = z.object({
  filters: z.array(viewFilterSchema).default([]),
  sorts: z.array(viewSortSchema).default([]),
  visibleFieldSlugs: z.array(z.string()).nullable().optional(),
  fieldWidths: z
    .record(z.string().min(1), z.number().int().min(VIEW_FIELD_MIN_WIDTH).max(VIEW_FIELD_MAX_WIDTH))
    .optional(),
  // ── Gallery-only presentation config (ignored by table views) ──
  // Which attachment field supplies the cover image (null = no cover).
  coverFieldSlug: z.string().nullable().optional(),
  coverFit: galleryCoverFitSchema.optional(),
  cardSize: galleryCardSizeSchema.optional(),
  // Whether to render the field label above each value on a card.
  showFieldLabels: z.boolean().optional(),
  // ── Kanban-only: which single-select field stacks records into columns.
  stackByFieldSlug: z.string().nullable().optional(),
  // ── Calendar-only: which date field positions records on the month grid.
  dateFieldSlug: z.string().nullable().optional(),
  // ── Gantt-only: the start/end date fields bounding each record's bar, plus
  // the time-axis granularity.
  startFieldSlug: z.string().nullable().optional(),
  endFieldSlug: z.string().nullable().optional(),
  ganttScale: ganttScaleSchema.optional(),
});

export const viewSchema = z.object({
  id: z.string(),
  baseId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  type: viewTypeSchema,
  config: viewConfigSchema,
  status: z.enum(["active", "archived"]),
  createdBy: z.string(),
  createdByUser: userRefSchema.nullable().optional().default(null),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createViewInputSchema = z.object({
  config: viewConfigSchema.optional().default({ filters: [], sorts: [] }),
  description: z.string().optional().default(""),
  message: z.string().optional().default("Create view"),
  name: z.string().min(1),
  type: viewTypeSchema.optional().default("table"),
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
  type: viewTypeSchema.optional(),
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
