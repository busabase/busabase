import { oc } from "@orpc/contract";
import { z } from "zod";
import { nodeSchema, pendingChangeRequestSchema } from "../../contract/schemas";

// --- Doc domain schemas (storage-backed body) ---

export const docSchema = z.object({
  node: nodeSchema,
  storagePrefix: z.string(),
  body: z.string(),
});

export const createDocInputSchema = z.object({
  parentNodeId: z
    .string()
    .optional()
    .describe(
      "Parent folder: a node id or a folder slug (default: the space root). Must be a folder or the space root; container-incapable node types (Base, Doc, AirApp, etc.) cannot hold children.",
    ),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  body: z.string().optional().default(""),
  // Permission-aware default: omitted merges immediately if the actor has
  // write access on the parent node, otherwise falls back to a pending
  // ChangeRequest (status "in_review"). Pass explicit `autoMerge: false` to
  // force review even with write access.
  autoMerge: z.boolean().optional(),
});

// Doc domain oRPC routes; composed into the root contract in contract/busabase.ts.
//
// `list` and `get` are deliberately absent: `GET /docs` and `GET /docs/{nodeId}`
// were retired in favour of the unified Node surface. List Docs with
// `GET /nodes?types=doc` (lightweight summaries — the old list downloaded every
// Doc body) and read one with `GET /nodes/{nodeId}`, which returns the same
// `docSchema` payload under `type: "doc"`.
//
// `updateBody` and `createChangeRequest` are gone too: both write paths were
// unified into `PUT /nodes/{nodeId}/content` (`contract/node-content-schemas.ts`)
// with a server-decided `autoMerge`, alongside whiteboard/workflow/html — see
// `apps/busabase/content/spec/node-content-storage.md` (D3).
/** A merged-in-the-same-call create returns this (see `materializedBaseSchema`). */
export const materializedDocSchema = docSchema.extend({ materialized: z.literal(true) });

export const docContract = {
  create: oc
    .route({
      method: "POST",
      path: "/docs",
      tags: ["Docs"],
      summary: "Create Doc node",
      successDescription:
        "Merged in the same call when the actor has write access on the parent node — the materialized Doc node comes back (`materialized: true`). Review-first when the actor lacks write access or passes `autoMerge: false`: a pending ChangeRequest proposing the Doc (`materialized: false`). A retry of the same request (a Doc with this slug already in this folder, same name and body) returns that Doc; a different name or body is a 409 naming the existing Doc — edit it with PUT /nodes/{nodeId}/content or pick another slug. The slug used by a Doc in another folder is a 409 too.",
    })
    .input(createDocInputSchema)
    .output(z.union([materializedDocSchema, pendingChangeRequestSchema])),
};
