import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema, nodeSchema } from "../../contract/schemas";

// --- Doc domain schemas (storage-backed body) ---

export const docSchema = z.object({
  node: nodeSchema,
  storagePrefix: z.string(),
  body: z.string(),
});

export const createDocInputSchema = z.object({
  parentNodeId: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  body: z.string().optional().default(""),
});

export const updateDocInputSchema = z.object({
  body: z.string(),
});

export const createDocChangeRequestInputSchema = z.object({
  body: z.string(),
  message: z.string().optional().default("Update doc"),
  submittedBy: z.string().optional().default("local-producer"),
});

// Doc domain oRPC routes; composed into the root contract in contract/busabase.ts.
export const docContract = {
  list: oc
    .route({
      method: "GET",
      path: "/docs",
      tags: ["Docs"],
      summary: "List Doc nodes",
      successDescription: "Doc nodes with their storage-backed bodies.",
    })
    .output(z.array(docSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/docs",
      tags: ["Docs"],
      summary: "Create Doc node",
      successDescription: "Created Doc node and initialized its body.",
    })
    .input(createDocInputSchema)
    .output(docSchema),
  get: oc
    .route({
      method: "GET",
      path: "/docs/{nodeId}",
      tags: ["Docs"],
      summary: "Get Doc node",
      successDescription: "Doc node detail and body.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(docSchema),
  updateBody: oc
    .route({
      method: "PUT",
      path: "/docs/{nodeId}/body",
      tags: ["Docs"],
      summary: "Update Doc body",
      successDescription: "Updated the Doc body.",
    })
    .input(updateDocInputSchema.extend({ nodeId: z.string() }))
    .output(docSchema),
  createChangeRequest: oc
    .route({
      method: "POST",
      path: "/docs/{nodeId}/change-requests",
      tags: ["Docs", "Change Requests"],
      summary: "Create Doc change request",
      successDescription: "Created a change request that proposes a new Doc body.",
    })
    .input(createDocChangeRequestInputSchema.extend({ nodeId: z.string() }))
    .output(changeRequestSchema),
};
