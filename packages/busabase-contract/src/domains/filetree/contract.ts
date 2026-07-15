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
  size: z.number(),
  updatedAt: z.string().nullable(),
  mimeType: z.string().nullable(),
  assetId: z.string(),
  displayName: z.string().nullable(),
});

const assetFileInputSchema = z
  .object({
    path: z.string().min(1),
    assetId: z.string().min(1),
    displayName: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .strict();

const textFileInputSchema = z
  .object({
    path: z.string().min(1),
    content: z.string().default(""),
    mimeType: z.string().optional(),
  })
  .strict();

const assetFileOperationInputSchema = z
  .object({
    kind: z.enum(["create", "update"]),
    path: z.string().min(1),
    assetId: z.string().min(1),
    displayName: z.string().optional(),
    mimeType: z.string().optional(),
    baseContentHash: z.string().optional(),
  })
  .strict();

const textFileOperationInputSchema = z
  .object({
    kind: z.enum(["create", "update"]),
    path: z.string().min(1),
    content: z.string(),
    mimeType: z.string().optional(),
    baseContentHash: z.string().optional(),
  })
  .strict();

export const fileTreeNodeSchema = z.object({
  node: nodeSchema,
  entryFile: z.string(),
  visibility: z.enum(["private", "workspace", "public"]),
  version: z.string(),
  files: z.array(fileTreeFileSchema),
});

export const createFileTreeInputSchema = z.object({
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
  visibility: z.enum(["private", "workspace", "public"]).optional().default("private"),
  version: z.string().optional().default("0.1.0"),
  files: z
    .array(z.union([assetFileInputSchema, textFileInputSchema]))
    .optional()
    .default([]),
  // Review-first by default: without `autoMerge: true`, this proposes the node
  // as a pending ChangeRequest (status "in_review") instead of creating it
  // immediately. Pass `autoMerge: true` only for callers that don't need human
  // review (seed/migration scripts, an explicit no-review agent task).
  autoMerge: z.boolean().optional().default(false),
  // "merge" (default): `files` is layered on top of the config's default seed
  // files by path — a caller supplying just a couple of extra files (e.g. a
  // Skill's own reference doc) still gets the default scaffold (SKILL.md,
  // skill.json, ...) for any path they didn't provide themselves. "replace":
  // `files` replaces the defaults entirely — for a caller handing over a
  // complete, different-shaped project (e.g. an AirApp seeded with a Vite
  // project instead of the default Hono template) who does NOT want leftover
  // default files with unrelated content mixed in.
  mergeMode: z.enum(["merge", "replace"]).optional().default("merge"),
});

export const fileTreeFileOperationInputSchema = z.union([
  assetFileOperationInputSchema,
  textFileOperationInputSchema,
  z
    .object({
      kind: z.literal("delete"),
      path: z.string().min(1),
      baseContentHash: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("metadata_update"),
      metadata: z
        .object({
          entryFile: z.string().optional(),
          visibility: z.enum(["private", "workspace", "public"]).optional(),
          version: z.string().optional(),
        })
        .default({}),
    })
    .strict(),
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
        successDescription: `${label} nodes with their Asset-backed file trees.`,
      })
      .output(z.array(fileTreeNodeSchema)),
    create: oc
      .route({
        method: "POST",
        path: basePath,
        tags: [tag],
        summary: `Create ${label} node`,
        successDescription: `Review-first by default: a pending ChangeRequest proposing the ${label} node (\`materialized: false\`). Returns the materialized ${label} node instead (\`materialized: true\`) when \`autoMerge: true\` is passed.`,
      })
      .input(createFileTreeInputSchema)
      .output(
        z.union([
          fileTreeNodeSchema.extend({ materialized: z.literal(true) }),
          changeRequestSchema.extend({ materialized: z.literal(false) }),
        ]),
      ),
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
        successDescription: `Asset-backed files mounted under the ${label} node.`,
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
          encoding: z.enum(["utf8", "url"]),
          content: z.string(),
          mimeType: z.string(),
          assetId: z.string(),
          displayName: z.string().nullable(),
          assetUrl: z.string().nullable(),
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
