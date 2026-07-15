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
  // Review-first by default: without `autoMerge: true`, this proposes the Doc
  // as a pending ChangeRequest (status "in_review") instead of creating it
  // immediately. Pass `autoMerge: true` only for callers that don't need human
  // review (seed/migration scripts, an explicit no-review agent task).
  autoMerge: z.boolean().optional().default(false),
});

export const updateDocInputSchema = z.object({
  body: z.string(),
});

export const createDocChangeRequestInputSchema = z.object({
  body: z.string(),
  message: z
    .string()
    .optional()
    .default("Update doc")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Add rollback steps to the deploy runbook".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
});

// Doc domain oRPC routes; composed into the root contract in contract/busabase.ts.
export const docContract = {
  list: oc
    .route({
      method: "GET",
      path: "/docs",
      tags: ["Docs"],
      summary: "List Doc nodes",
      successDescription: "Doc nodes with their storage-backed bodies.",
    })
    .output(z.array(docSchema)),
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
  get: oc
    .route({
      method: "GET",
      path: "/docs/{nodeId}",
      tags: ["Docs"],
      summary: "Get Doc node",
      successDescription: "Doc node detail and body.",
    })
    .input(z.object({ nodeId: z.string() }))
    .output(docSchema),
  readLines: oc
    .route({
      method: "GET",
      path: "/docs/{nodeId}/lines",
      tags: ["Docs"],
      summary: "Read an exact line range from a Doc body",
      successDescription:
        "Lines [startLine, endLine] (range capped at 2000 lines / ~2MB response) sliced from the Doc's full body — Docs are KB-scale, so the whole body is read in memory; no byte-range/checkpoint machinery like assets.readTextLines uses for potentially multi-GB files. The Doc-domain follow-up to a Unified Grep match with `source: \"docs\"`, so an agent can read just the lines around a match instead of `get`'s entire body.",
    })
    .input(ReadDocLinesInputSchema)
    .output(ReadLinesVOSchema),
  updateBody: oc
    .route({
      method: "PUT",
      path: "/docs/{nodeId}/body",
      tags: ["Docs"],
      summary: "Update Doc body",
      successDescription: "Updated the Doc body.",
    })
    .input(updateDocInputSchema.extend({ nodeId: z.string() }))
    .output(docSchema),
  createChangeRequest: oc
    .route({
      method: "POST",
      path: "/docs/{nodeId}/change-requests",
      tags: ["Docs", "Change Requests"],
      summary: "Create Doc change request",
      successDescription: "Created a change request that proposes a new Doc body.",
    })
    .input(createDocChangeRequestInputSchema.extend({ nodeId: z.string() }))
    .output(changeRequestSchema),
};
