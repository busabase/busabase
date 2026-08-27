import {
  type EmbedFramePolicyVO,
  EmbedFramePolicyVOSchema,
} from "busabase-contract/contract/embed-link-schemas";
import { nodeSchema } from "busabase-contract/contract/schemas";
import { baseSchema } from "busabase-contract/domains/base/contract/base-schemas";
import { recordSchema } from "busabase-contract/domains/base/contract/record-schemas";
import { docSchema } from "busabase-contract/domains/doc/contract";
import { FileNodeVOSchema } from "busabase-contract/domains/file-node/types";
import { fileTreeNodeSchema } from "busabase-contract/domains/filetree/contract";
import type { ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { z } from "zod";

const FileTreeReadVOSchema = z.object({
  nodeId: z.string(),
  path: z.string(),
  encoding: z.enum(["utf8", "url"]),
  content: z.string(),
  mimeType: z.string(),
  assetId: z.string(),
  displayName: z.string().nullable(),
  assetUrl: z.string().nullable(),
  contentHash: z.string(),
});

export const EmbedNodeDetailVOSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("base"),
    base: baseSchema,
    records: z.array(recordSchema),
    recordsTruncated: z.boolean(),
  }),
  z.object({ type: z.literal("doc"), doc: docSchema }),
  z.object({ type: z.literal("file"), file: FileNodeVOSchema }),
  z.object({
    type: z.literal("drive"),
    drive: fileTreeNodeSchema,
    entryFile: FileTreeReadVOSchema.nullable(),
  }),
  z.object({
    type: z.literal("skill"),
    skill: fileTreeNodeSchema,
    entryFile: FileTreeReadVOSchema.nullable(),
  }),
  z.object({
    type: z.literal("folder"),
    folder: z.object({ node: nodeSchema, children: z.array(nodeSchema) }),
  }),
  z.object({ type: z.literal("airapp"), airapp: fileTreeNodeSchema }),
]);
export type EmbedNodeDetailVO = z.infer<typeof EmbedNodeDetailVOSchema>;

export const ResolvedEmbedVOSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  type: z.literal("node"),
  typeId: z.string(),
  targetName: z.string(),
  expiresAt: z.string().datetime(),
  framePolicy: EmbedFramePolicyVOSchema,
  detail: EmbedNodeDetailVOSchema,
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
