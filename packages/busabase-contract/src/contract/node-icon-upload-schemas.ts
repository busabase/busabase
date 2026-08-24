import {
  ConfirmUploadInputSchema,
  ConfirmUploadVOSchema,
  RequestUploadUrlInputSchema,
  RequestUploadUrlVOSchema,
} from "open-domains/attachments/types";
import { z } from "zod";

/**
 * `nodes.icon.createUploadUrl` / `nodes.icon.confirm` — the node-avatar upload
 * pair, separate from `assets.createUploadUrl`/`assets.confirm`: a node icon is
 * a single-instance-per-node reference (stored on `busabase_nodes.icon`, not in
 * the Assets library — see `uploadNodeIcon` in
 * `domains/attachments/logic/attachments-logic.ts`), so it must never dedupe
 * onto (or be deleted alongside) a Drive Asset's attachment row. Extends the
 * generic open-domains upload DTOs with `nodeId`, which the server uses to
 * scope the upload's dedup namespace per-node.
 */
export const NodeIconUploadUrlInputSchema = RequestUploadUrlInputSchema.extend({
  nodeId: z.string(),
});
export type NodeIconUploadUrlInput = z.infer<typeof NodeIconUploadUrlInputSchema>;

export const NodeIconConfirmInputSchema = ConfirmUploadInputSchema.extend({
  nodeId: z.string(),
});
export type NodeIconConfirmInput = z.infer<typeof NodeIconConfirmInputSchema>;

export { RequestUploadUrlVOSchema as NodeIconUploadUrlVOSchema };
export { ConfirmUploadVOSchema as NodeIconConfirmVOSchema };
