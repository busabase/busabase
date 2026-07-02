import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema, nodeSchema } from "../../contract/schemas";

// --- Skill domain schemas (the skill VO + its change-request inputs) ---

export const skillFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder"]),
  size: z.number(),
  updatedAt: z.string().nullable(),
});

export const skillSchema = z.object({
  node: nodeSchema,
  storagePrefix: z.string(),
  entryFile: z.string(),
  visibility: z.enum(["private", "workspace", "public"]),
  version: z.string(),
  files: z.array(skillFileSchema),
});

export const createSkillInputSchema = z.object({
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

export const skillFileOperationInputSchema = z.discriminatedUnion("kind", [
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

export const createSkillChangeRequestInputSchema = z.object({
  message: z
    .string()
    .optional()
    .default("Update skill")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Rewrite SKILL.md quickstart for the new auth flow".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  operations: z.array(skillFileOperationInputSchema).min(1),
});

// Skill domain oRPC routes; composed into the root contract in contract/busabase.ts.
export const skillContract = {
  list: oc
    .route({
      method: "GET",
      path: "/skills",
      tags: ["Skills"],
      summary: "List Skill nodes",
      successDescription: "Skill nodes with their storage-backed file trees.",
    })
    .output(z.array(skillSchema)),
  create: oc
    .route({
      method: "POST",
      path: "/skills",
      tags: ["Skills"],
      summary: "Create Skill node",
      successDescription: "Created Skill node and initialized file tree.",
    })
    .input(createSkillInputSchema)
    .output(skillSchema),
  get: oc
    .route({
      method: "GET",
      path: "/skills/{nodeId}",
      tags: ["Skills"],
      summary: "Get Skill node",
      successDescription: "Skill node detail and file tree.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(skillSchema),
  listFiles: oc
    .route({
      method: "GET",
      path: "/skills/{nodeId}/files",
      tags: ["Skills"],
      summary: "List Skill files",
      successDescription: "Storage-backed files under the Skill node prefix.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(z.array(skillFileSchema)),
  readFile: oc
    .route({
      method: "GET",
      path: "/skills/{nodeId}/files/{+filePath}",
      tags: ["Skills"],
      summary: "Read Skill file",
      successDescription: "Skill file content and content hash.",
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
      path: "/skills/{nodeId}/change-requests",
      tags: ["Skills", "Change Requests"],
      summary: "Create Skill change request",
      successDescription: "Created file-tree change request for a Skill node.",
    })
    .input(createSkillChangeRequestInputSchema.extend({ nodeId: z.string() }))
    .output(changeRequestSchema),
};
