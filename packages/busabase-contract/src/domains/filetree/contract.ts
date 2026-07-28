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
  // Paths silently dropped from this create call by an uploaded `.gitignore`
  // (upload-safety layer 1 — see `logic/upload-safety.ts`). Empty on
  // ordinary get/list responses and on creates that didn't include a
  // `.gitignore`.
  skippedGitignorePaths: z.array(z.string()).optional().default([]),
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
  // Permission-aware default: omitted merges immediately if the actor has
  // write access on the parent node, otherwise falls back to a pending
  // ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to
  // force review even with write access.
  autoMerge: z.boolean().optional(),
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

/** Node types whose content is an Asset-backed file tree. Every one of them is
 *  served by the single `/file-trees` surface below — they differ only in their
 *  seed files and entry file, which is a `FileTreeKindConfig` concern (server
 *  side), not a transport one. */
export const FILE_TREE_NODE_TYPES = ["skill", "drive", "airapp"] as const;
export type FileTreeNodeType = (typeof FILE_TREE_NODE_TYPES)[number];
export const fileTreeNodeTypeSchema = z.enum(FILE_TREE_NODE_TYPES);

/** `nodeId` accepts a node id or a slug. A slug is only unique *within* a type,
 *  so pass `type` alongside it to disambiguate; a node id needs no hint. */
const fileTreeRefSchema = z.object({
  nodeId: z.string(),
  type: fileTreeNodeTypeSchema.optional(),
});

export const fileTreeContract = {
  list: oc
    .route({
      method: "GET",
      path: "/file-trees",
      tags: ["File Trees"],
      summary: "List file-tree nodes",
      successDescription:
        "Skill, Drive, and AirApp nodes with their Asset-backed file trees. Pass `type` to narrow to one kind.",
    })
    .input(z.object({ type: fileTreeNodeTypeSchema.optional() }))
    .output(z.array(fileTreeNodeSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/file-trees",
      tags: ["File Trees"],
      summary: "Create file-tree node",
      successDescription:
        "Review-first by default: a pending ChangeRequest proposing the node (`materialized: false`). Returns the materialized node instead (`materialized: true`) when `autoMerge: true` is passed.",
    })
    .input(createFileTreeInputSchema.extend({ type: fileTreeNodeTypeSchema }))
    .output(
      z.union([
        fileTreeNodeSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  get: oc
    .route({
      method: "GET",
      path: "/file-trees/{nodeId}",
      tags: ["File Trees"],
      summary: "Get file-tree node",
      successDescription: "File-tree node detail and its file list.",
    })
    .input(fileTreeRefSchema)
    .output(fileTreeNodeSchema),
  listFiles: oc
    .route({
      method: "GET",
      path: "/file-trees/{nodeId}/files",
      tags: ["File Trees"],
      summary: "List file-tree files",
      successDescription: "Asset-backed files mounted under the node.",
    })
    .input(fileTreeRefSchema)
    .output(z.array(fileTreeFileSchema)),
  readFile: oc
    .route({
      method: "GET",
      path: "/file-trees/{nodeId}/files/{+filePath}",
      tags: ["File Trees"],
      summary: "Read file-tree file",
      successDescription: "File content and content hash.",
    })
    .input(fileTreeRefSchema.extend({ filePath: z.string() }))
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
      path: "/file-trees/{nodeId}/change-requests",
      tags: ["File Trees", "Change Requests"],
      summary: "Create file-tree change request",
      successDescription: "Created file-tree change request for the node.",
    })
    .input(createFileTreeChangeRequestInputSchema.extend(fileTreeRefSchema.shape))
    .output(changeRequestSchema),
};
