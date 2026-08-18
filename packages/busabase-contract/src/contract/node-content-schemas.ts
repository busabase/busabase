/**
 * Input schema for the unified node-content write — `PUT /nodes/{nodeId}/content`.
 *
 * Replaces `PUT /docs/{nodeId}/body` and `POST /docs/{nodeId}/change-requests`,
 * and gives whiteboard/workflow/html a reviewed content write for the first
 * time (previously `PATCH /nodes/{nodeId}/metadata`, which created no
 * ChangeRequest at all). See `apps/busabase/content/spec/node-content-storage.md`
 * (D2/D3) for the full design.
 *
 * `kind` is redundant with the server-resolved `busabase_nodes.type` ON PURPOSE:
 * a wrong-shaped document becomes a contract-level 400 that NAMES the mismatch
 * (rather than a generic "invalid input" from a bare union with no discriminant),
 * and it renders in OpenAPI as a `oneOf` with an explicit discriminator an agent
 * can read straight off the schema instead of trial-and-erroring shapes. The
 * server still asserts `kind` matches the resolved node's actual type — this
 * field is a contract-level ergonomics/documentation win, not a trust boundary.
 *
 * Pure zod — no db/logic/server imports (this file is pulled into the browser
 * bundle and the React Native client is generated from its type graph).
 */

import { z } from "zod";
import {
  HtmlDocumentSchema,
  WhiteboardDocumentSchema,
  WorkflowDocumentSchema,
} from "../domains/rich-node/types";

// The node types this endpoint accepts — each owns exactly one document.
// Multi-file types (skill/drive/airapp) and relational types (base/form) are
// out of scope by design (spec D4).
export const NODE_CONTENT_TYPES = ["doc", "whiteboard", "workflow", "html"] as const;
export type NodeContentType = (typeof NODE_CONTENT_TYPES)[number];

/**
 * One arm per content-bearing node type, keyed by that type.
 *
 * `satisfies Record<NodeContentType, unknown>` is the exhaustiveness gate, and
 * it is the whole reason this object exists instead of the arms being written
 * inline in the union below. Adding a type to `NODE_CONTENT_TYPES` without an
 * arm here fails `tsc` (missing key), and an arm for a type not listed there
 * fails too (excess key).
 *
 * Without it, this was the ONE per-type table in the whole node-type surface
 * that failed **silently**: every sibling table (`NODE_DETAIL_VARIANTS`,
 * `COMMIT_PAYLOAD_SCHEMAS`, the breadcrumb and operation-label records, the
 * locale files) is `Record<…>`-typed and names the missing key at compile time.
 * A type declared content-bearing but left out of the union here would simply
 * be rejected by `PUT /nodes/{nodeId}/content` at runtime, with an "invalid
 * input" that points at the caller rather than at the omission.
 * See `content/spec/node-type-plugin-architecture.md`.
 */
const NODE_CONTENT_VARIANTS = {
  doc: z.object({ kind: z.literal("doc"), body: z.string() }),
  whiteboard: z.object({ kind: z.literal("whiteboard"), document: WhiteboardDocumentSchema }),
  workflow: z.object({ kind: z.literal("workflow"), document: WorkflowDocumentSchema }),
  html: z.object({ kind: z.literal("html"), document: HtmlDocumentSchema }),
} satisfies Record<NodeContentType, unknown>;

// Listed explicitly rather than `Object.values(...)`: `z.discriminatedUnion`
// infers from a TUPLE, and spreading a mapped object erases the per-arm types —
// `NodeContentInput` would degrade to something the server could not narrow on
// `kind`. The gate above is what keeps this list honest; this is the same
// arrangement `NodeDetailVOSchema` uses for the same reason.
export const nodeContentInputSchema = z.discriminatedUnion("kind", [
  NODE_CONTENT_VARIANTS.doc,
  NODE_CONTENT_VARIANTS.whiteboard,
  NODE_CONTENT_VARIANTS.workflow,
  NODE_CONTENT_VARIANTS.html,
]);
export type NodeContentInput = z.infer<typeof nodeContentInputSchema>;

export const updateNodeContentInputSchema = z.object({
  nodeId: z.string(),
  content: nodeContentInputSchema,
  message: z
    .string()
    .optional()
    .default("Update content")
    .describe(
      'Explanation shown to the human reviewer. Write a conventional-commit style subject — imperative verb + what + why, e.g. "Add rollback steps to the deploy runbook".',
    ),
  submittedBy: z.string().optional().default("local-producer"),
  // Server-decided, not client-decided: `shouldAutoMerge(autoMerge, hasWrite) =
  // autoMerge !== false && hasWrite`. Omitted/true merges immediately IF the
  // actor holds `write` on the node; otherwise (or with explicit `false`) the
  // content lands as a pending ChangeRequest instead. A `changeRequest`-level
  // caller passing `autoMerge: true` still lands in review — the server never
  // lets the client escalate past its own permission.
  autoMerge: z.boolean().optional(),
});
export type UpdateNodeContentInput = z.infer<typeof updateNodeContentInputSchema>;
