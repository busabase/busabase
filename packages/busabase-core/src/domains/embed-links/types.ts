import {
  type EmbedFramePolicyVO,
  EmbedFramePolicyVOSchema,
  EmbedNodeTypeSchema,
} from "busabase-contract/contract/embed-link-schemas";
import type { ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { z } from "zod";

/**
 * The node an Embed Link points at — identity only. The page renders it with
 * the same Node Detail components the workbench uses, which read their own
 * content under the link's capability, so nothing here is a content snapshot.
 */
export const EmbedTargetNodeVOSchema = z.object({
  id: z.string(),
  type: EmbedNodeTypeSchema,
  slug: z.string(),
  name: z.string(),
});
export type EmbedTargetNodeVO = z.infer<typeof EmbedTargetNodeVOSchema>;

export const ResolvedEmbedVOSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  type: z.literal("node"),
  typeId: z.string(),
  targetName: z.string(),
  expiresAt: z.string().datetime(),
  framePolicy: EmbedFramePolicyVOSchema,
  node: EmbedTargetNodeVOSchema,
});
export type ResolvedEmbedVO = z.infer<typeof ResolvedEmbedVOSchema>;

export interface ResolvedChangeRequestEmbedVO {
  id: string;
  spaceId: string;
  type: "change-request";
  typeId: string;
  targetName: string;
  expiresAt: string;
  framePolicy: EmbedFramePolicyVO;
  changeRequest: ChangeRequestVO;
}

export interface ResolvedRecordDetailEmbedVO {
  id: string;
  spaceId: string;
  type: "record-detail";
  typeId: string;
  targetName: string;
  expiresAt: string;
  framePolicy: EmbedFramePolicyVO;
  record: RecordVO;
}

export type ResolvedPolymorphicEmbedVO =
  | ResolvedEmbedVO
  | ResolvedChangeRequestEmbedVO
  | ResolvedRecordDetailEmbedVO;

export const AirAppEmbedRuntimeVOSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  expiresAt: z.string().datetime(),
  framePolicy: EmbedFramePolicyVOSchema,
  files: z.record(z.string(), z.string()),
});
export type AirAppEmbedRuntimeVO = z.infer<typeof AirAppEmbedRuntimeVOSchema>;
