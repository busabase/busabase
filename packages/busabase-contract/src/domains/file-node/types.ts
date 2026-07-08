import { z } from "zod";
import { nodeSchema } from "../../contract/schemas";
import { AssetVOSchema } from "../assets/types";

export const FileNodeMetadataSchema = z.object({
  assetId: z.string(),
});
export type FileNodeMetadata = z.infer<typeof FileNodeMetadataSchema>;

export const FileNodeVOSchema = z.object({
  node: nodeSchema,
  asset: AssetVOSchema,
});
export type FileNodeVO = z.infer<typeof FileNodeVOSchema>;
