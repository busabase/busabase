/**
 * Attachments — DTO/VO Zod schemas + inferred types (the contract's type source
 * of truth). `schema/` is reserved for DB (PO); DTO/VO live here.
 *
 * Kernel-generic: `metadata` is an open record (apps layer their own typed
 * metadata on top — e.g. `apps/busabase-cloud`'s `AttachmentType` enum).
 */

import { z } from "zod";

/** Open metadata bag — apps define their own shape; stored verbatim as jsonb. */
export const AttachmentMetadataSchema = z.record(z.string(), z.unknown());
export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>;

/**
 * Denormalized attachment reference stored inline in a record's `attachment`
 * field value (Airtable-style: the cell holds an array of these, so rendering
 * needs no join). `id` points at the `attachments` registry row.
 */
export const AttachmentRefSchema = z.object({
  id: z.string(),
  url: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const RequestUploadUrlInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  spaceId: z.string().optional(),
  context: z
    .string()
    .regex(/^[a-zA-Z0-9_/-]+$/)
    .max(100)
    .optional(),
  /** Content fingerprint (e.g. "sha256:<hex>") for dedup; computed client-side. */
  contentHash: z.string().max(80).optional(),
});
export type RequestUploadUrlDTO = z.infer<typeof RequestUploadUrlInputSchema>;

export const ConfirmUploadInputSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  spaceId: z.string().optional(),
  context: z
    .string()
    .regex(/^[a-zA-Z0-9_/-]+$/)
    .max(100)
    .optional(),
  metadata: AttachmentMetadataSchema.optional(),
  /** Content fingerprint (e.g. "sha256:<hex>") persisted for dedup. */
  contentHash: z.string().max(80).optional(),
});
export type ConfirmUploadDTO = z.infer<typeof ConfirmUploadInputSchema>;

/** VO: presigned (or dev) upload URL result. */
export const RequestUploadUrlVOSchema = z.object({
  uploadUrl: z.string(),
  storageKey: z.string(),
  publicUrl: z.string(),
  expiresIn: z.number(),
  /**
   * True when an identical file (same contentHash, same scope) already exists.
   * The client should SKIP the byte upload and the confirm step, and use
   * `attachmentId`/`publicUrl` directly. `uploadUrl` is empty in this case.
   */
  duplicate: z.boolean().optional(),
  /** Existing attachment id — present only when `duplicate` is true. */
  attachmentId: z.string().optional(),
});
export type RequestUploadUrlVO = z.infer<typeof RequestUploadUrlVOSchema>;

/** VO: confirm-upload result. */
export const ConfirmUploadVOSchema = z.object({
  success: z.boolean(),
  attachmentId: z.string(),
  storageKey: z.string(),
  publicUrl: z.string(),
});
export type ConfirmUploadVO = z.infer<typeof ConfirmUploadVOSchema>;
