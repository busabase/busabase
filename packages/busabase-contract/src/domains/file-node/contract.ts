import { oc } from "@orpc/contract";
import { z } from "zod";
import { FileNodeVOSchema } from "./types";

export const createFileNodeInputSchema = z.object({
  parentNodeId: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  assetId: z.string().min(1),
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
      successDescription: "Created a first-class File node that references an Asset.",
    })
    .input(createFileNodeInputSchema)
    .output(FileNodeVOSchema),
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
