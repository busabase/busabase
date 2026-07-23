import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema } from "../../contract/schemas";
import { FileNodeVOSchema } from "./types";

export const createFileNodeInputSchema = z.object({
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
  assetId: z.string().min(1),
  // Permission-aware default: omitted merges immediately if the actor has
  // write access on the parent node, otherwise falls back to a pending
  // ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to
  // force review even with write access.
  autoMerge: z.boolean().optional(),
});

export const fileContract = {
  list: oc
    .route({
      method: "GET",
      path: "/files",
      tags: ["Files"],
      summary: "List File nodes",
      successDescription: "Workspace File nodes with their backing Asset metadata.",
    })
    .output(z.array(FileNodeVOSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/files",
      tags: ["Files"],
      summary: "Create File node",
      successDescription:
        "Review-first by default: a pending ChangeRequest proposing the File node (`materialized: false`). Returns the materialized File node instead (`materialized: true`) when `autoMerge: true` is passed.",
    })
    .input(createFileNodeInputSchema)
    .output(
      z.union([
        FileNodeVOSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  get: oc
    .route({
      method: "GET",
      path: "/files/{nodeId}",
      tags: ["Files"],
      summary: "Get File node",
      successDescription: "File node detail and backing Asset metadata.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(FileNodeVOSchema),
};
