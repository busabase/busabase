/**
 * Attachments — DTO/VO Zod schemas + inferred types (the contract's type source
 * of truth). `schema/` is reserved for DB (PO); DTO/VO live here.
 *
 * Kernel-generic: `metadata` is an open record (apps layer their own typed
 * metadata on top — e.g. Busabase Cloud's `AttachmentType` enum).
 */
import { z } from "zod";
/** Open metadata bag — apps define their own shape; stored verbatim as jsonb. */
export declare const AttachmentMetadataSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>;
/**
 * Denormalized attachment reference stored inline in a record's `attachment`
 * field value (Airtable-style: the cell holds an array of these, so rendering
 * needs no join). `id` points at the `attachments` registry row.
 */
export declare const AttachmentRefSchema: z.ZodObject<
  {
    id: z.ZodString;
    url: z.ZodString;
    fileName: z.ZodString;
    mimeType: z.ZodString;
    size: z.ZodNumber;
  },
  z.core.$strip
>;
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
export declare const RequestUploadUrlInputSchema: z.ZodObject<
  {
    fileName: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    spaceId: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    contentHash: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type RequestUploadUrlDTO = z.infer<typeof RequestUploadUrlInputSchema>;
export declare const ConfirmUploadInputSchema: z.ZodObject<
  {
    storageKey: z.ZodString;
    fileName: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    spaceId: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    contentHash: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type ConfirmUploadDTO = z.infer<typeof ConfirmUploadInputSchema>;
/** VO: presigned (or dev) upload URL result. */
export declare const RequestUploadUrlVOSchema: z.ZodObject<
  {
    uploadUrl: z.ZodString;
    storageKey: z.ZodString;
    publicUrl: z.ZodString;
    expiresIn: z.ZodNumber;
    duplicate: z.ZodOptional<z.ZodBoolean>;
    attachmentId: z.ZodOptional<z.ZodString>;
    assetId: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export type RequestUploadUrlVO = z.infer<typeof RequestUploadUrlVOSchema>;
/** VO: confirm-upload result. */
export declare const ConfirmUploadVOSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
    attachmentId: z.ZodString;
    assetId: z.ZodOptional<z.ZodString>;
    storageKey: z.ZodString;
    publicUrl: z.ZodString;
  },
  z.core.$strip
>;
export type ConfirmUploadVO = z.infer<typeof ConfirmUploadVOSchema>;
