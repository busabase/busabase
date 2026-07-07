import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  changeRequestSchema,
  createDeleteChangeRequestInputSchema,
  listInputSchema,
  reviseOperationInputSchema,
} from "../../../contract/schemas";
import {
  archiveBaseInputSchema,
  baseFieldSchema,
  baseSchema,
  convertFieldChangeRequestInputSchema,
  createBaseFieldInputSchema,
  createBaseInputSchema,
  createFieldChangeRequestInputSchema,
  deleteFieldChangeRequestInputSchema,
  previewFieldConversionInputSchema,
  previewFieldConversionOutputSchema,
  reorderFieldsChangeRequestInputSchema,
  restoreBaseInputSchema,
  restoreFieldChangeRequestInputSchema,
  updateFieldChangeRequestInputSchema,
} from "./base-schemas";
import {
  createChangeRequestInputSchema,
  listRecordsInputSchema,
  listRecordsResponseSchema,
  recordFieldFilterInputSchema,
  recordLinkSchema,
  recordSchema,
  restoreRecordInputSchema,
} from "./record-schemas";
import {
  createViewInputSchema,
  deleteViewInputSchema,
  restoreViewInputSchema,
  updateViewInputSchema,
  viewSchema,
} from "./view-schemas";

// Base domain oRPC routes (bases / records / views); composed in contract/busabase.ts.
export const baseContract = {
  list: oc
    .route({
      method: "GET",
      path: "/bases",
      tags: ["Bases"],
      summary: "List Bases",
      successDescription: "Flat list of developer-facing Bases.",
    })
    .output(z.array(baseSchema)),
  listArchived: oc
    .route({
      method: "GET",
      path: "/bases/archived",
      tags: ["Bases"],
      summary: "List archived bases",
      successDescription: "Bases that have been archived.",
    })
    .output(z.array(baseSchema)),
  get: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}",
      tags: ["Bases"],
      summary: "Get Base",
      successDescription: "Single Base by id or slug.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(baseSchema.nullable()),
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
      summary: "List active views for a Base",
      successDescription: "Saved table views for a Base.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(z.array(viewSchema)),
  listArchivedViews: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}/views/archived",
      tags: ["Views"],
      summary: "List archived views for a Base",
      successDescription: "Views that have been archived (soft-deleted) from a Base.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(z.array(viewSchema)),
  listArchivedRecords: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}/records/archived",
      tags: ["Records"],
      summary: "List archived records for a Base",
      successDescription: "Records that have been archived (soft-deleted) from a Base.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(z.array(recordSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/bases",
      tags: ["Bases"],
      summary: "Create Base",
      successDescription: "Created Base.",
    })
    .input(createBaseInputSchema)
    .output(baseSchema),
  createChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Change Request in Base",
      successDescription: "Created change request for review.",
    })
    .input(createChangeRequestInputSchema.extend({ baseId: z.string() }))
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
  createFieldChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Add Field change request",
      successDescription: "Created change request that proposes a new field.",
    })
    .input(createFieldChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  createViewChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/views/change-requests",
      tags: ["Views", "Change Requests"],
      summary: "Create View change request",
      successDescription: "Created change request that proposes a new View.",
    })
    .input(createViewInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  deleteFieldChangeRequest: oc
    .route({
      method: "DELETE",
      path: "/bases/{baseId}/fields/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Delete Field change request",
      successDescription: "Created change request that soft-deletes a field.",
    })
    .input(deleteFieldChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  updateFieldChangeRequest: oc
    .route({
      method: "PATCH",
      path: "/bases/{baseId}/fields/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Update Field change request",
      successDescription:
        "Created change request that updates field metadata (name, required, options).",
    })
    .input(updateFieldChangeRequestInputSchema.extend({ baseId: z.string() }))
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
  convertFieldChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/convert/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Create Convert Field change request",
      successDescription: "Created change request that converts a field to a different type.",
    })
    .input(convertFieldChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  reorderFieldsChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/reorder/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Reorder fields",
      successDescription: "Created change request that reorders fields.",
    })
    .input(reorderFieldsChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  archiveChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/archive/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Archive base",
      successDescription: "Created change request that archives a base.",
    })
    .input(archiveBaseInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  restoreChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/restore/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Restore base",
      successDescription: "Created change request that restores an archived base.",
    })
    .input(restoreBaseInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
  restoreFieldChangeRequest: oc
    .route({
      method: "POST",
      path: "/bases/{baseId}/fields/restore/change-requests",
      tags: ["Bases", "Change Requests"],
      summary: "Restore deleted field",
      successDescription: "Created change request that restores a soft-deleted field.",
    })
    .input(restoreFieldChangeRequestInputSchema.extend({ baseId: z.string() }))
    .output(changeRequestSchema),
};

export const recordContract = {
  list: oc
    .route({
      method: "GET",
      path: "/records",
      tags: ["Records"],
      summary: "List records",
      successDescription: "Canonical records created from merged change requests.",
    })
    .input(listInputSchema)
    .output(z.array(recordSchema)),
  listPaged: oc
    .route({
      method: "GET",
      path: "/records/paged",
      tags: ["Records"],
      summary: "List records with keyset pagination",
      successDescription:
        "A page of canonical records plus an opaque nextCursor (null at the end).",
    })
    .input(listRecordsInputSchema)
    .output(listRecordsResponseSchema),
  get: oc
    .route({
      method: "GET",
      path: "/records/{recordId}",
      tags: ["Records"],
      summary: "Get record",
      successDescription: "Canonical record detail.",
    })
    .input(z.object({ recordId: z.string() }))
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
  updateChangeRequest: oc
    .route({
      method: "PUT",
      path: "/records/{recordId}/change-requests",
      tags: ["Records", "Change Requests"],
      summary: "Create record update change request",
      successDescription: "Created change request that proposes updating a canonical record.",
    })
    .input(reviseOperationInputSchema.extend({ recordId: z.string() }))
    .output(changeRequestSchema),
  deleteChangeRequest: oc
    .route({
      method: "DELETE",
      path: "/records/{recordId}/change-requests",
      tags: ["Records", "Change Requests"],
      summary: "Create record delete change request",
      successDescription: "Created change request that proposes archiving or deleting a record.",
    })
    .input(createDeleteChangeRequestInputSchema.extend({ recordId: z.string() }))
    .output(changeRequestSchema),
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
  restoreChangeRequest: oc
    .route({
      method: "POST",
      path: "/records/{recordId}/restore/change-requests",
      tags: ["Records", "Change Requests"],
      summary: "Create record restore change request",
      successDescription: "Created change request that restores an archived record.",
    })
    .input(restoreRecordInputSchema.extend({ recordId: z.string() }))
    .output(changeRequestSchema),
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
  updateChangeRequest: oc
    .route({
      method: "PUT",
      path: "/views/{viewId}/change-requests",
      tags: ["Views", "Change Requests"],
      summary: "Create View update change request",
      successDescription: "Created change request that proposes updating a View.",
    })
    .input(updateViewInputSchema.extend({ viewId: z.string() }))
    .output(changeRequestSchema),
  deleteChangeRequest: oc
    .route({
      method: "DELETE",
      path: "/views/{viewId}/change-requests",
      tags: ["Views", "Change Requests"],
      summary: "Create View delete change request",
      successDescription: "Created change request that proposes archiving a View.",
    })
    .input(deleteViewInputSchema.extend({ viewId: z.string() }))
    .output(changeRequestSchema),
  restoreChangeRequest: oc
    .route({
      method: "POST",
      path: "/views/{viewId}/restore/change-requests",
      tags: ["Views", "Change Requests"],
      summary: "Create View restore change request",
      successDescription: "Created change request that restores an archived View.",
    })
    .input(restoreViewInputSchema.extend({ viewId: z.string() }))
    .output(changeRequestSchema),
};
