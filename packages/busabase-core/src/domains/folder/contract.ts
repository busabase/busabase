import { oc } from "@orpc/contract";
import { z } from "zod";
import { nodeSchema } from "../../contract/schemas";

// --- Folder domain schema (a folder + its direct child nodes) ---

export const folderSchema = z.object({
  node: nodeSchema,
  children: z.array(nodeSchema),
});

// Folder domain oRPC routes; composed into the root contract in contract/busabase.ts.
export const folderContract = {
  list: oc
    .route({
      method: "GET",
      path: "/folders",
      tags: ["Folders"],
      summary: "List Folder nodes",
      successDescription: "Folder nodes with their direct children.",
    })
    .output(z.array(folderSchema)),
  get: oc
    .route({
      method: "GET",
      path: "/folders/{nodeId}",
      tags: ["Folders"],
      summary: "Get Folder node",
      successDescription: "Folder node and its direct children.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(folderSchema),
};
