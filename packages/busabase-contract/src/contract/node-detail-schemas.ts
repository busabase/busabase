/**
 * Unified Node detail VO — the output of the single `GET /nodes/{nodeId}`
 * operation that replaced `docs.get`, `files.get`, `folders.get`, and
 * `fileTrees.get`.
 *
 * An agent that holds a node id should not have to discover the node's type
 * first and then pick one of four type-specific get operations. The type is a
 * property of the node, not a property of the caller's intent, so it belongs on
 * the RESPONSE as a discriminator rather than in the path.
 *
 * Backward-compatible on purpose: each variant is the exact detail VO the
 * retired operation returned, plus a top-level `type` literal. A caller that
 * already reads `.node` / `.body` / `.asset` / `.children` / `.files` keeps
 * working once it narrows on `type`.
 *
 * Pure zod — no db/logic/server imports (this file is pulled into the browser
 * bundle and the React Native client is generated from its type graph).
 */

import { z } from "zod";
import { docSchema } from "../domains/doc/contract";
import { FileNodeVOSchema } from "../domains/file-node/types";
import { fileTreeNodeSchema } from "../domains/filetree/contract";
import { folderSchema } from "../domains/folder/contract";
import { NODE_TYPES, type NodeType } from "../domains/registry";
import { nodeSchema } from "./schemas";

/**
 * The fallback shape for a registered node type that has no richer typed detail
 * of its own yet (`base`, `form`, `whiteboard`, `workflow`, `html`). Returning
 * the plain node row is strictly additive — none of these had a typed get
 * before — and keeps the union exhaustive so the server can never be asked for
 * a type it cannot answer.
 */
const genericNodeDetailSchema = <T extends NodeType>(type: T) =>
  z.object({
    type: z.literal(type),
    node: nodeSchema,
  });

/**
 * One variant per registered node type, keyed by that type.
 *
 * `satisfies Record<NodeType, unknown>` is the exhaustiveness gate: registering
 * a new first-party node type in `domains/registry.ts` without adding a variant
 * here fails `tsc` at the contract (missing key), and a variant for a type that
 * is not registered fails too (excess key). The alternative — discovering it at
 * runtime when `nodes.get` meets a node it cannot describe — is exactly the
 * "unknown node type -> malformed VO" failure this union exists to prevent.
 */
export const NODE_DETAIL_VARIANTS = {
  folder: folderSchema.extend({ type: z.literal("folder") }),
  doc: docSchema.extend({ type: z.literal("doc") }),
  file: FileNodeVOSchema.extend({ type: z.literal("file") }),
  // Skills, Drives, and AirApps are one server-side shape (`fileTreeNodeSchema`)
  // but three real node types — there is no synthetic "file-tree" node type, so
  // each gets its own discriminated variant rather than a shared alias.
  skill: fileTreeNodeSchema.extend({ type: z.literal("skill") }),
  drive: fileTreeNodeSchema.extend({ type: z.literal("drive") }),
  airapp: fileTreeNodeSchema.extend({ type: z.literal("airapp") }),
  base: genericNodeDetailSchema("base"),
  form: genericNodeDetailSchema("form"),
  whiteboard: genericNodeDetailSchema("whiteboard"),
  workflow: genericNodeDetailSchema("workflow"),
  html: genericNodeDetailSchema("html"),
} satisfies Record<NodeType, unknown>;

export const NodeDetailVOSchema = z.discriminatedUnion("type", [
  NODE_DETAIL_VARIANTS.folder,
  NODE_DETAIL_VARIANTS.doc,
  NODE_DETAIL_VARIANTS.file,
  NODE_DETAIL_VARIANTS.skill,
  NODE_DETAIL_VARIANTS.drive,
  NODE_DETAIL_VARIANTS.airapp,
  NODE_DETAIL_VARIANTS.base,
  NODE_DETAIL_VARIANTS.form,
  NODE_DETAIL_VARIANTS.whiteboard,
  NODE_DETAIL_VARIANTS.workflow,
  NODE_DETAIL_VARIANTS.html,
]);

export type NodeDetailVO = z.infer<typeof NodeDetailVOSchema>;

/**
 * `nodeId` accepts a node id OR a slug — every retired typed get did. A slug is
 * only unique *within* a type, so `type` disambiguates it; a node id needs no
 * hint. An ambiguous slug with no `type` is refused rather than silently
 * resolved to whichever row sorts first.
 */
export const getNodeInputSchema = z.object({
  nodeId: z.string().describe("Node id, or a slug that is unique within its type."),
  type: z
    .enum(NODE_TYPES)
    .optional()
    .describe(
      "Optional disambiguation hint, only needed when `nodeId` is a slug that exists under more than one node type.",
    ),
});
