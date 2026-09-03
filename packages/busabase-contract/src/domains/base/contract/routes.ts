import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema, listByStatusInputSchema } from "../../../contract/schemas";
import {
  baseFieldSchema,
  baseLifecycleChangeRequestInputSchema,
  baseSchema,
  createBaseFieldInputSchema,
  createBaseInputSchema,
  fieldChangeRequestInputSchema,
  previewFieldConversionInputSchema,
  previewFieldConversionOutputSchema,
} from "./base-schemas";
import {
  countRecordsInputSchema,
  countRecordsResponseSchema,
  createBulkChangeRequestInputSchema,
  createBulkUpdateChangeRequestInputSchema,
  createChangeRequestInputSchema,
  groupRecordsInputSchema,
  groupRecordsResponseSchema,
  listRecordsInputSchema,
  listRecordsPageInputSchema,
  listRecordsPageResponseSchema,
  listRecordsResponseSchema,
  recordChangeRequestInputSchema,
  recordFieldFilterInputSchema,
  recordGetInputSchema,
  recordLinkSchema,
  recordSchema,
} from "./record-schemas";
import { viewChangeRequestInputSchema, viewSchema } from "./view-schemas";

// Base domain oRPC routes (bases / records / views); composed in contract/busabase.ts.
export const baseContract = {
  list: oc
    .route({
      method: "GET",
      path: "/bases",
      tags: ["Bases"],
      summary: "List Bases",
      successDescription:
        "Developer-facing Bases. `status=archived` returns the archived ones instead of the active ones.",
    })
    .input(listByStatusInputSchema)
    .output(z.array(baseSchema)),
  get: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}",
      tags: ["Bases"],
      summary: "Get Base",
      successDescription:
        "Single Base by id or slug, or 404 when it does not exist or is not visible.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(baseSchema),
  listDeletedFields: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}/fields/deleted",
      tags: ["Bases"],
      summary: "List deleted fields",
      successDescription: "Fields that have been soft-deleted from a Base.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(z.array(baseFieldSchema)),
  listViews: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}/views",
      tags: ["Views"],
      summary: "List views for a Base",
      successDescription:
        "Saved table views for a Base. `status=archived` returns the soft-deleted ones instead.",
    })
    .input(listByStatusInputSchema.extend({ baseId: z.string() }))
    .output(z.array(viewSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/bases",
      tags: ["Bases"],
      summary: "Create Base",
      successDescription:
        "Review-first by default: a pending ChangeRequest proposing the Base (`materialized: false`). Returns the materialized Base instead (`materialized: true`) when `autoMerge: true` is passed.",
    })
    .input(createBaseInputSchema)
    .output(
      z.union([
        baseSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  createChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Change Request in Base",
      successDescription:
        "Review-first by default: a pending ChangeRequest proposing the record (`materialized: false`). Returns the materialized record instead (`materialized: true`) when `autoMerge: true` is passed.",
    })
    .input(createChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(
      z.union([
        recordSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  createBulkChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/records/bulk-change-request",
      tags: ["Bases", "Change Requests"],
      summary: "Create bulk record Change Request in Base",
      successDescription: "Created one change request proposing many record creates.",
    })
    .input(createBulkChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  createBulkUpdateChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/records/bulk-update-change-request",
      tags: ["Bases", "Change Requests"],
      summary: "Create bulk record update Change Request in Base",
      successDescription: "Created one change request proposing many record updates.",
    })
    .input(createBulkUpdateChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  createField: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields",
      tags: ["Bases"],
      summary: "Create Base field",
      successDescription: "Created Base field.",
    })
    .input(createBaseFieldInputSchema.extend({ baseId: z.string() }))
    .output(baseSchema),
  fieldChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create field change request",
      successDescription:
        "Created change request proposing a field change. `operation` selects what to propose: `create`, `update`, `delete`, `convert` (change type), `reorder`, or `restore` (undo a soft delete).",
    })
    .input(fieldChangeRequestInputSchema)
    .output(changeRequestSchema),
  previewFieldConversion: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/convert/preview",
      tags: ["Bases"],
      summary: "Preview field type conversion",
      successDescription: "Dry-run statistics for converting a field to a different type.",
    })
    .input(previewFieldConversionInputSchema.extend({ baseId: z.string() }))
    .output(previewFieldConversionOutputSchema),
  lifecycleChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/lifecycle/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Base lifecycle change request",
      successDescription:
        "Created change request that moves a Base between its lifecycle states. `operation` selects the direction: `archive` (soft-delete a live Base) or `restore` (bring an archived Base back).",
    })
    .input(baseLifecycleChangeRequestInputSchema)
    .output(changeRequestSchema),
};

export const recordContract = {
  // One listing for records: always keyset-paginated, `baseId` always honoured,
  // `status` picking live rows or the trash. The old unpaginated `/records`
  // silently dropped `baseId` (its schema had no such field), so a caller
  // scoping to one Base quietly got the whole space back.
  list: oc
    .route({
      method: "GET",
      path: "/records",
      tags: ["Records"],
      summary: "List records",
      successDescription:
        "A page of canonical records plus an opaque nextCursor (null at the end). `status=archived` lists the Base's trash instead of its live rows.",
    })
    .input(listRecordsInputSchema)
    .output(listRecordsResponseSchema),
  listPage: oc
    .route({
      method: "GET",
      path: "/records/page",
      tags: ["Records"],
      summary: "List a numbered record page",
      successDescription:
        "A random-access page of active records. When viewId is supplied, the saved view is authoritatively filtered and sorted before total and page slicing are calculated. `dateRange` additionally scopes to a `[gte, lt)` UTC instant window on a date/created_time/updated_time field.",
    })
    .input(listRecordsPageInputSchema)
    .output(listRecordsPageResponseSchema),
  count: oc
    .route({
      method: "GET",
      path: "/records/count",
      tags: ["Records"],
      summary: "Count records",
      description:
        "A real SQL COUNT — always the exact total, never a partial or capped number, so it's safe to render as a canonical figure (e.g. a dashboard summary tile). " +
        "Plain `baseId` scoping is always cheap. Adding `viewId` and/or `filters` is exact too — provably-exact conditions (e.g. text equals/contains, not_empty/is_empty, checkbox is_true/is_false) stay a cheap SQL COUNT; everything else falls back to evaluating every matching row server-side, which is exact but not free on a large Base. Both `viewId` and `filters` require `baseId`.",
      successDescription:
        "Total active records matching the scope: the whole space, one Base, a saved View, an ad-hoc filter set, or a combination.",
    })
    .input(countRecordsInputSchema)
    .output(countRecordsResponseSchema),
  groupBy: oc
    .route({
      method: "GET",
      path: "/records/group-by",
      tags: ["Records"],
      summary: "Count records per group",
      description:
        "One SQL GROUP BY returning every bucket's exact count — the split a board column header or a summary tile needs, without reading the records themselves. " +
        "`fieldSlug` must name a `select` or `checkbox` field: their stored value IS the grouping key, so the buckets are exactly the ones a client would build. Grouping by a text, number or date field is rejected rather than approximated (text keys are truncated at the projection limit; date keys would bucket by the server's timezone, not the viewer's). " +
        "`viewId` and `filters` narrow the set first, with the same exactness rules as `records.count`: provably-exact conditions stay a cheap SQL aggregate, anything else falls back to evaluating every matching row server-side — exact, but not free on a large Base. " +
        'Groups come back keyed by raw choice id (or `"true"`/`"false"`), with `null` for records that have no value; labels are the client\'s to render.',
      successDescription:
        "Every group's exact count, plus the total across all groups. Groups with zero records are omitted — a Base's full choice list lives in its field definition, so the client already knows which buckets to render empty.",
    })
    .errors({
      BAD_REQUEST: { status: 400, message: "Field is not groupable" },
      NOT_FOUND: { status: 404, message: "Base or field not found" },
    })
    .input(groupRecordsInputSchema)
    .output(groupRecordsResponseSchema),
  get: oc
    .route({
      method: "GET",
      path: "/records/get",
      tags: ["Records"],
      summary: "Get record",
      description:
        "Provide exactly one selector: recordId alone, or the complete baseId + fieldSlug + valueText tuple. Other combinations return 400.",
      successDescription: "One canonical record selected by id or exact field value.",
    })
    .errors({
      BAD_REQUEST: { status: 400, message: "Exactly one record selector is required" },
      NOT_FOUND: { status: 404, message: "Record not found" },
    })
    .input(recordGetInputSchema)
    .output(recordSchema),
  search: oc
    .route({
      method: "GET",
      path: "/records/search",
      tags: ["Records"],
      summary: "Filter records by field text",
      successDescription: "Canonical records matching a field text filter.",
    })
    .input(recordFieldFilterInputSchema)
    .output(z.array(recordSchema)),
  changeRequest: oc
    .route({
      method: "POST",
      path: "/records/{recordId}/change-requests",
      tags: ["Records", "Change Requests"],
      summary: "Create record change request",
      successDescription:
        "Creates a record change request selected by `operation`. Updates auto-merge when the actor has write access unless `autoMerge: false`; delete and restore remain review-first.",
    })
    .input(recordChangeRequestInputSchema)
    .output(
      z.union([
        recordSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  listChangeRequests: oc
    .route({
      method: "GET",
      path: "/records/{recordId}/change-requests",
      tags: ["Records", "Change Requests"],
      summary: "List record change request history",
      successDescription: "Change requests and operations connected to the canonical record.",
    })
    .input(z.object({ recordId: z.string() }))
    .output(z.array(changeRequestSchema)),
  listLinks: oc
    .route({
      method: "GET",
      path: "/records/{recordId}/links",
      tags: ["Records"],
      summary: "List record links",
      successDescription: "Active outbound links from a canonical record.",
    })
    .input(z.object({ recordId: z.string() }))
    .output(z.array(recordLinkSchema)),
};

export const viewContract = {
  changeRequest: oc
    .route({
      method: "POST",
      path: "/views/change-requests",
      tags: ["Views", "Change Requests"],
      summary: "Create view change request",
      successDescription:
        "Proposes a view change. `operation` selects what to propose: `create` (addressed by `baseId`), or `update` / `delete` / `restore` (addressed by `viewId`). Review-first when the actor lacks write access or passes `autoMerge: false` — a pending ChangeRequest (`materialized: false`). Otherwise the change is approved and merged in the same call and the materialized View comes back instead (`materialized: true`).",
    })
    .input(viewChangeRequestInputSchema)
    .output(
      z.union([
        viewSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
};
