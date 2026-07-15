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
  // Review-first by default: without `autoMerge: true`, this proposes the File
  // node as a pending ChangeRequest (status "in_review") instead of creating it
  // immediately. Pass `autoMerge: true` only for callers that don't need human
  // review (seed/migration scripts, an explicit no-review agent task).
  autoMerge: z.boolean().optional().default(false),
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
