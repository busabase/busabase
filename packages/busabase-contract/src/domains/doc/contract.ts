import { oc } from "@orpc/contract";
import { z } from "zod";
import { changeRequestSchema, nodeSchema } from "../../contract/schemas";
import { ReadLinesVOSchema } from "../assets/types";
import { ReadDocLinesInputSchema } from "./types";

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
      "Parent node id. Must be a folder or the space root; container-incapable node types (Base, Doc, AirApp, etc.) cannot hold children.",
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
export const docContract = {
  create: oc
    .route({
      method: "POST",
      path: "/docs",
      tags: ["Docs"],
      summary: "Create Doc node",
      successDescription:
        "Review-first by default: a pending ChangeRequest proposing the Doc (`materialized: false`). Returns the materialized Doc node instead (`materialized: true`) when `autoMerge: true` is passed.",
    })
    .input(createDocInputSchema)
    .output(
      z.union([
        docSchema.extend({ materialized: z.literal(true) }),
        changeRequestSchema.extend({ materialized: z.literal(false) }),
      ]),
    ),
  readLines: oc
    .route({
      method: "GET",
      path: "/docs/{nodeId}/lines",
      tags: ["Docs"],
      summary: "Read an exact line range from a Doc body",
      successDescription:
        "Lines [startLine, endLine] (range capped at 2000 lines / ~2MB response) sliced from the Doc's full body — Docs are KB-scale, so the whole body is read in memory; no byte-range/checkpoint machinery like assets.readTextLines uses for potentially multi-GB files. The Doc-domain follow-up to a Unified Grep match with `source: \"docs\"`, so an agent can read just the lines around a match instead of `nodes.get`'s entire body.",
    })
    .input(ReadDocLinesInputSchema)
    .output(ReadLinesVOSchema),
};
