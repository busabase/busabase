import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  changeRequestSchema,
  createDeleteChangeRequestInputSchema,
  listInputSchema,
  reviseOperationInputSchema,
} from "../../../contract/schemas";
import {
  baseSchema,
  createBaseFieldInputSchema,
  createBaseInputSchema,
  createFieldChangeRequestInputSchema,
} from "./base-schemas";
import {
  createChangeRequestInputSchema,
  recordFieldFilterInputSchema,
  recordSchema,
} from "./record-schemas";
import {
  createViewInputSchema,
  deleteViewInputSchema,
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
  listViews: oc
    .route({
      method: "GET",
      path: "/bases/{baseId}/views",
      tags: ["Views"],
      summary: "List Base views",
      successDescription: "Saved table views for a Base.",
    })
    .input(z.object({ baseId: z.string() }))
    .output(z.array(viewSchema)),
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
};
