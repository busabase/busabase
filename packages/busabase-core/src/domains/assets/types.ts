/**
 * Assets — VO Zod schemas (the contract's output source of truth). Pure zod, no
 * logic/db imports (client-safe). `schema/` holds the PO; these are the VOs the
 * `/assets` library and the "where-used" panel render.
 */
import { z } from "zod";

/** One library entry: the deduped file + its busabase metadata + usage count. */
export const AssetVOSchema = z.object({
  id: z.string(),
  attachmentId: z.string(),
  name: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string(),
  contentHash: z.string().nullable(),
  /** How many places reference this asset (Base records + Doc bodies). */
  usageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AssetVO = z.infer<typeof AssetVOSchema>;

/** One place an asset is referenced — the row behind "Where Used". */
export const AssetUsageVOSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  /** Node slug, so the UI can link to the owning Base/Doc (`/{type}/{slug}`). */
  nodeSlug: z.string(),
  /** Base record id, or null for whole-node usages (e.g. a Doc body). */
  recordId: z.string().nullable(),
  /** Attachment field slug, or null for whole-node usages. */
  fieldSlug: z.string().nullable(),
  createdAt: z.string(),
});
export type AssetUsageVO = z.infer<typeof AssetUsageVOSchema>;

/** Asset detail = the library entry plus every place it is used. */
export const AssetDetailVOSchema = z.object({
  asset: AssetVOSchema,
  usages: z.array(AssetUsageVOSchema),
});
export type AssetDetailVO = z.infer<typeof AssetDetailVOSchema>;
