import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema, nodeSchema } from "../../contract/schemas";

export interface FileTreeKindConfig {
  type: string;
  label: string;
  icon: string;
  routeBase: string;
  tag: string;
  entryFile: string;
}

export const fileTreeFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder"]),
  size: z.number(),
  updatedAt: z.string().nullable(),
});

export const fileTreeNodeSchema = z.object({
  node: nodeSchema,
  storagePrefix: z.string(),
  entryFile: z.string(),
  visibility: z.enum(["private", "workspace", "public"]),
  version: z.string(),
  files: z.array(fileTreeFileSchema),
});

export const createFileTreeInputSchema = z.object({
  parentNodeId: z.string().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  visibility: z.enum(["private", "workspace", "public"]).optional().default("private"),
  version: z.string().optional().default("0.1.0"),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string().default(""),
      }),
    )
    .optional()
    .default([]),
});

export const fileTreeFileOperationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["create", "update"]),
    path: z.string().min(1),
    content: z.string(),
    baseContentHash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("delete"),
    path: z.string().min(1),
    baseContentHash: z.string().optional(),
  }),
  z.object({
    kind: z.literal("metadata_update"),
    metadata: z
      .object({
        entryFile: z.string().optional(),
        visibility: z.enum(["private", "workspace", "public"]).optional(),
        version: z.string().optional(),
      })
      .default({}),
  }),
]);

export const createFileTreeChangeRequestInputSchema = z.object({
  message: z
    .string()
    .optional()
    .default("Update file tree")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Rewrite README.md quickstart for the new auth flow".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  operations: z.array(fileTreeFileOperationInputSchema).min(1),
});

export const makeFileTreeContract = (routeBase: string, tag: string) => {
  const label = tag.endsWith("s") ? tag.slice(0, -1) : tag;
  const basePath = `/${routeBase}` as `/${string}`;
  return {
    list: oc
      .route({
        method: "GET",
        path: basePath,
        tags: [tag],
        summary: `List ${label} nodes`,
        successDescription: `${label} nodes with their storage-backed file trees.`,
      })
      .output(z.array(fileTreeNodeSchema)),
    create: oc
      .route({
        method: "POST",
        path: basePath,
        tags: [tag],
        summary: `Create ${label} node`,
        successDescription: `Created ${label} node and initialized file tree.`,
      })
      .input(createFileTreeInputSchema)
      .output(fileTreeNodeSchema),
    get: oc
      .route({
        method: "GET",
        path: `${basePath}/{nodeId}` as `/${string}`,
        tags: [tag],
        summary: `Get ${label} node`,
        successDescription: `${label} node detail and file tree.`,
      })
      .input(z.object({ nodeId: z.string() }))
      .output(fileTreeNodeSchema),
    listFiles: oc
      .route({
        method: "GET",
        path: `${basePath}/{nodeId}/files` as `/${string}`,
        tags: [tag],
        summary: `List ${label} files`,
        successDescription: `Storage-backed files under the ${label} node prefix.`,
      })
      .input(z.object({ nodeId: z.string() }))
      .output(z.array(fileTreeFileSchema)),
    readFile: oc
      .route({
        method: "GET",
        path: `${basePath}/{nodeId}/files/{+filePath}` as `/${string}`,
        tags: [tag],
        summary: `Read ${label} file`,
        successDescription: `${label} file content and content hash.`,
      })
      .input(z.object({ nodeId: z.string(), filePath: z.string() }))
      .output(
        z.object({
          nodeId: z.string(),
          path: z.string(),
          content: z.string(),
          contentHash: z.string(),
        }),
      ),
    createChangeRequest: oc
      .route({
        method: "POST",
        path: `${basePath}/{nodeId}/change-requests` as `/${string}`,
        tags: [tag, "Change Requests"],
        summary: `Create ${label} change request`,
        successDescription: `Created file-tree change request for a ${label} node.`,
      })
      .input(createFileTreeChangeRequestInputSchema.extend({ nodeId: z.string() }))
      .output(changeRequestSchema),
  };
};
