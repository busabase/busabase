/**
 * Attachments — DTO/VO Zod schemas + inferred types (the contract's type source
 * of truth). `schema/` is reserved for DB (PO); DTO/VO live here.
 *
 * Kernel-generic: `metadata` is an open record (apps layer their own typed
 * metadata on top — e.g. Busabase Cloud's `AttachmentType` enum).
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
  /** Host-specific logical asset id, when the app maps uploads into an Asset library. */
  assetId: z.string().optional(),
});
export type RequestUploadUrlVO = z.infer<typeof RequestUploadUrlVOSchema>;

/** VO: confirm-upload result. */
export const ConfirmUploadVOSchema = z.object({
  success: z.boolean(),
  attachmentId: z.string(),
  /** Host-specific logical asset id, when the app maps uploads into an Asset library. */
  assetId: z.string().optional(),
  storageKey: z.string(),
  publicUrl: z.string(),
});
export type ConfirmUploadVO = z.infer<typeof ConfirmUploadVOSchema>;

// ── Multipart upload (large files) ──────────────────────────────────────────
//
// create → signParts (in batches) → PUT each part → complete | abort.
// The server mints the key (same namespace as `createUploadUrl`) and decides
// the part size; the client only uploads bytes to the URLs it is handed.

/** Same input as a single upload URL request: size/type/hash checks run identically. */
export const CreateMultipartUploadInputSchema = RequestUploadUrlInputSchema;
export type CreateMultipartUploadDTO = z.infer<typeof CreateMultipartUploadInputSchema>;

export const CreateMultipartUploadVOSchema = z.object({
  storageKey: z.string(),
  publicUrl: z.string(),
  /** Empty when `duplicate` is true (nothing to upload). */
  uploadId: z.string(),
  /** Size of every part except the last (which may be smaller). */
  partSize: z.number().int().nonnegative(),
  partCount: z.number().int().nonnegative(),
  /** Lifetime (seconds) of each part URL returned by `signParts`. */
  expiresIn: z.number(),
  /** Identical bytes already stored in this scope — skip the upload entirely. */
  duplicate: z.boolean().optional(),
  attachmentId: z.string().optional(),
  assetId: z.string().optional(),
});
export type CreateMultipartUploadVO = z.infer<typeof CreateMultipartUploadVOSchema>;

const MultipartUploadRefSchema = z.object({
  storageKey: z.string().min(1),
  uploadId: z.string().min(1).max(1024),
  spaceId: z.string().optional(),
});

export const SignMultipartPartsInputSchema = MultipartUploadRefSchema.extend({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
});
export type SignMultipartPartsDTO = z.infer<typeof SignMultipartPartsInputSchema>;

export const SignMultipartPartsVOSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int(), uploadUrl: z.string() })),
  expiresIn: z.number(),
});
export type SignMultipartPartsVO = z.infer<typeof SignMultipartPartsVOSchema>;

/**
 * Completing a multipart upload also confirms it — same fields as `confirm`,
 * plus the uploadId. No part list: the server reads the parts (and their
 * ETags) from the store itself — see `completeMultipartUpload`.
 */
export const CompleteMultipartUploadInputSchema = ConfirmUploadInputSchema.extend({
  uploadId: z.string().min(1).max(1024),
});
export type CompleteMultipartUploadDTO = z.infer<typeof CompleteMultipartUploadInputSchema>;

export const AbortMultipartUploadInputSchema = MultipartUploadRefSchema;
export type AbortMultipartUploadDTO = z.infer<typeof AbortMultipartUploadInputSchema>;

export const AbortMultipartUploadVOSchema = z.object({ success: z.boolean() });
export type AbortMultipartUploadVO = z.infer<typeof AbortMultipartUploadVOSchema>;
