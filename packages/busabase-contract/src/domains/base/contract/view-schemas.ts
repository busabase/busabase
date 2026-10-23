import { z } from "zod";
import { userRefSchema } from "../../../contract/schemas";
import { VIEW_FIELD_MAX_WIDTH, VIEW_FIELD_MIN_WIDTH, type ViewFilterConditionVO } from "../types";

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

// The root is level 1. Explicit finite schemas keep OpenAPI portable and reject
// excessive nesting before recursive evaluation. Limits also bound API work.
export const VIEW_FILTER_MAX_DEPTH = 3;
export const VIEW_FILTER_MAX_RULES = 100;
export const viewFilterConjunctionSchema = z.enum(["and", "or"]);
export const deepestViewFilterGroupSchema = z.object({
  conjunction: viewFilterConjunctionSchema,
  conditions: z.array(viewFilterSchema).min(1).max(VIEW_FILTER_MAX_RULES),
});
export const viewFilterGroupSchema = z.object({
  conjunction: viewFilterConjunctionSchema,
  conditions: z
    .array(z.union([viewFilterSchema, deepestViewFilterGroupSchema]))
    .min(1)
    .max(VIEW_FILTER_MAX_RULES),
});
export const viewFilterConditionSchema = z.union([viewFilterSchema, viewFilterGroupSchema]);
export const viewFiltersSchema: z.ZodType<ViewFilterConditionVO[]> = z
  .array(viewFilterConditionSchema)
  .max(VIEW_FILTER_MAX_RULES)
  .superRefine((conditions, ctx) => {
    const count = (items: typeof conditions): number =>
      items.reduce((total, item) => total + ("conditions" in item ? count(item.conditions) : 1), 0);
    if (count(conditions) > VIEW_FILTER_MAX_RULES)
      ctx.addIssue({ code: "custom", message: "A view supports at most 100 filter conditions." });
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
  filters: viewFiltersSchema.default([]),
  filterConjunction: viewFilterConjunctionSchema.optional(),
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
  // Shared tab order within the Base. Lists come back sorted by it (ties broken
  // by creation time); the lowest one is the view the Base opens on.
  position: z.number().int(),
  createdBy: z.string(),
  createdByUser: userRefSchema.nullable().optional().default(null),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Permission-aware default, identical to `createBase` / `createDoc` /
// `createFileTreeNode` / the record endpoints: omitted merges immediately when
// the actor has `write` on the Base's node, otherwise falls back to a pending
// ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to force
// review even with write access — that is what the dashboard and the mobile app
// do, because their "propose for review" affordance must queue a CR regardless
// of who is clicking it.
const autoMergeSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether to approve and merge this view change immediately. Omitted defaults to merging immediately if the actor has write access on the Base's node, otherwise falling back to a pending Change Request; pass explicit false to force review even with write access.",
  );

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
  autoMerge: autoMergeSchema,
});

// Zod's .partial() retains nested defaults, which would turn omitted keys into clears.
const viewConfigPatchSchema = viewConfigSchema.omit({ filters: true, sorts: true }).extend({
  filters: viewFiltersSchema.optional(),
  sorts: z.array(viewSortSchema).optional(),
});

export const updateViewInputSchema = z.object({
  config: viewConfigPatchSchema
    .optional()
    .describe("Only supplied config keys change; empty arrays and null clear supported settings."),
  description: z.string().optional(),
  message: z.string().optional().default("Update view"),
  name: z.string().min(1).optional(),
  type: viewTypeSchema.optional(),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Move the view to this 0-based index among the Base's active views; the others shift to make room. The order is shared by everyone, and the leftmost view (0) is the one the Base opens on. Out-of-range values clamp to the end.",
    ),
  submittedBy: z.string().optional().default("local-producer"),
  autoMerge: autoMergeSchema,
});

export const deleteViewInputSchema = z.object({
  message: z.string().optional().default("Delete view"),
  submittedBy: z.string().optional().default("local-producer"),
  autoMerge: autoMergeSchema,
});

export const restoreViewInputSchema = z.object({
  message: z.string().optional().default("Restore view"),
  submittedBy: z.string().optional().default("local-producer"),
  autoMerge: autoMergeSchema,
});

/**
 * Every view change request in one shape. `create` is addressed by `baseId`
 * (there is no view id yet) and the rest by `viewId` — that difference is why
 * these used to live on two different route prefixes, but it is a property of
 * the payload, not of the operation being performed.
 */
export const viewChangeRequestInputSchema = z.discriminatedUnion("operation", [
  createViewInputSchema.extend({
    operation: z.literal("create"),
    baseId: z.string().min(1).describe("Base the new view belongs to."),
  }),
  updateViewInputSchema.extend({
    operation: z.literal("update"),
    viewId: z.string().min(1),
  }),
  deleteViewInputSchema.extend({
    operation: z.literal("delete"),
    viewId: z.string().min(1),
  }),
  restoreViewInputSchema.extend({
    operation: z.literal("restore"),
    viewId: z.string().min(1),
  }),
]);
