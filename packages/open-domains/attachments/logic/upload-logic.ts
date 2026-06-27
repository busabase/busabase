/**
 * Attachments upload logic (open-domains) — auth-agnostic, transport-neutral.
 *
 * Copy of `share-domains/attachments/logic` but: any MIME type allowed, 25MB
 * cap, and throws `ORPCError` (all consumers are oRPC). Pure `(input, userId,
 * db, table)` — no auth/billing/context coupling. Hosts pass their own db,
 * userId (real id or "local"), and the `attachments` table instance.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { extractFileExtension, storage } from "openlib/storage";
import type { attachments } from "../schema/attachments";

/** Max upload size (25MB). Any MIME type is accepted. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

const UPLOAD_EXPIRES_IN = 3600;

export interface RequestUploadUrlInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  spaceId?: string;
  context?: string;
  /** Content fingerprint (e.g. "sha256:<hex>") for dedup; computed client-side. */
  contentHash?: string;
}

export interface RequestUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  publicUrl: string;
  expiresIn: number;
  duplicate?: boolean;
  attachmentId?: string;
}

/**
 * Content-addressed storage key: identical bytes → identical key → ONE physical
 * object, globally (even across spaces/tenants). Combined with scoped dedup this
 * gives store-once without a cross-tenant existence oracle: same-scope re-uploads
 * skip the upload entirely; cross-scope uploads re-PUT the SAME key (idempotent
 * overwrite, no extra storage, nothing leaked). Falls back to a per-owner random
 * key when no hash is supplied (legacy clients) — fully backward compatible.
 */
function contentAddressedKey(contentHash: string, fileName: string): string {
  const ext = extractFileExtension(fileName);
  const hashHex = contentHash.replace(/^sha256:/, "");
  // Git/OCI-style: algorithm segment + 2-char fan-out (filesystem-friendly for the
  // local adapter; harmless on S3/R2). Keep the extension so direct-serve + the dev
  // proxy infer the right Content-Type (mime is also in the registry row).
  const shard = hashHex.slice(0, 2);
  return `attachments/blobs/sha256/${shard}/${hashHex}${ext ? `.${ext}` : ""}`;
}

/**
 * Find an existing attachment with the same content fingerprint within the same
 * scope (prefer the space; fall back to the owner for space-less uploads). This
 * is what makes re-uploading identical bytes a no-op at the storage layer.
 */
async function findByContentHash(
  db: any,
  attachmentsTable: typeof attachments,
  contentHash: string,
  userId: string,
  spaceId?: string,
): Promise<{ id: string; storageKey: string } | null> {
  const scope = spaceId
    ? eq(attachmentsTable.spaceId, spaceId)
    : eq(attachmentsTable.userId, userId);
  const rows = await db
    .select({ id: attachmentsTable.id, storageKey: attachmentsTable.storageKey })
    .from(attachmentsTable)
    .where(and(eq(attachmentsTable.contentHash, contentHash), scope))
    .orderBy(desc(attachmentsTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Per-host upload policy overrides; defaults preserve 25MB / any MIME type. */
export interface UploadPolicyOptions {
  /** Max upload size in bytes (default: 25MB). */
  maxFileSize?: number;
  /** Allowed MIME types (default: undefined = any type accepted). */
  allowedMimeTypes?: string[];
}

export async function requestUploadUrl(
  input: RequestUploadUrlInput,
  userId: string,
  // Optional dedup wiring: hosts that pass their db + table get content-hash
  // dedup (identical re-upload returns the existing object, no bytes written).
  db?: any,
  attachmentsTable?: typeof attachments,
  // Optional policy overrides so hosts can cap size / restrict MIME types while
  // still reusing the shared dedup + content-addressing.
  opts?: UploadPolicyOptions,
): Promise<RequestUploadUrlResult> {
  const maxFileSize = opts?.maxFileSize ?? MAX_FILE_SIZE;
  if (input.sizeBytes > maxFileSize) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File size exceeds the maximum allowed size of ${maxFileSize / 1024 / 1024}MB`,
    });
  }
  if (opts?.allowedMimeTypes && !opts.allowedMimeTypes.includes(input.mimeType)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `File type ${input.mimeType} is not allowed.`,
    });
  }

  // Dedup short-circuit: identical bytes already stored → reuse, skip upload.
  if (input.contentHash && db && attachmentsTable) {
    const existing = await findByContentHash(
      db,
      attachmentsTable,
      input.contentHash,
      userId,
      input.spaceId,
    );
    if (existing) {
      return {
        uploadUrl: "",
        storageKey: existing.storageKey,
        publicUrl: storage.getPublicUrl(existing.storageKey),
        expiresIn: 0,
        duplicate: true,
        attachmentId: existing.id,
      };
    }
  }

  // Content-addressed key when we have a hash (store-once across tenants);
  // otherwise the legacy per-owner random key (backward compatible).
  const ext = extractFileExtension(input.fileName);
  const context = input.context || "general";
  const storageKey = input.contentHash
    ? contentAddressedKey(input.contentHash, input.fileName)
    : `attachments/${userId}/${context}/${generateNanoID()}${ext ? `.${ext}` : ""}`;

  // Dev mode uploads through the app's /api/dev/upload route (avoids
  // presigned-URL CORS/signature issues with the local storage adapter).
  // The storage adapter returns the right target: s3/r2/minio presign for a direct
  // browser→bucket PUT; local returns the dev relay sentinel (handled by the uploader).
  const uploadUrl = await storage.generateUploadPresignedUrl(
    storageKey,
    input.mimeType,
    UPLOAD_EXPIRES_IN,
  );

  return {
    uploadUrl,
    storageKey,
    publicUrl: storage.getPublicUrl(storageKey),
    expiresIn: UPLOAD_EXPIRES_IN,
    duplicate: false,
  };
}

export interface ConfirmUploadInput {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  spaceId?: string;
  context?: string;
  /** Flexible metadata bag; apps define their own type. */
  metadata?: unknown;
  /** Content fingerprint (e.g. "sha256:<hex>") persisted for dedup. */
  contentHash?: string;
}

export interface ConfirmUploadResult {
  success: boolean;
  attachmentId: string;
  storageKey: string;
  publicUrl: string;
}

export async function confirmUpload(
  input: ConfirmUploadInput,
  userId: string,
  db: any, // host passes its own differently-typed drizzle client
  attachmentsTable: typeof attachments,
): Promise<ConfirmUploadResult> {
  // Safety-net dedup: if the same content was registered concurrently (or the
  // host didn't wire request-time dedup), reuse the existing row instead of
  // inserting a duplicate registry entry.
  if (input.contentHash) {
    const existing = await findByContentHash(
      db,
      attachmentsTable,
      input.contentHash,
      userId,
      input.spaceId,
    );
    if (existing) {
      return {
        success: true,
        attachmentId: existing.id,
        storageKey: existing.storageKey,
        publicUrl: storage.getPublicUrl(existing.storageKey),
      };
    }
  }

  const [attachment] = await db
    .insert(attachmentsTable)
    .values({
      storageKey: input.storageKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash || null,
      context: input.context || "general",
      userId,
      spaceId: input.spaceId || null,
      metadata: input.metadata || null,
    })
    .returning({ id: attachmentsTable.id });

  if (!attachment) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to record attachment" });
  }

  return {
    success: true,
    attachmentId: attachment.id,
    storageKey: input.storageKey,
    publicUrl: storage.getPublicUrl(input.storageKey),
  };
}

/**
 * Refcount-safe delete. Content-addressed keys are SHARED by many registry rows
 * (across spaces/tenants), so the physical object must only be removed once the
 * LAST row referencing that storageKey is gone. Always delete attachments via
 * this helper — NEVER call `storage.deleteObject` on an attachment key directly,
 * or you may delete bytes another tenant still references.
 */
export async function deleteAttachmentSafely(
  attachmentId: string,
  db: any,
  attachmentsTable: typeof attachments,
): Promise<{ deletedRow: boolean; deletedObject: boolean }> {
  const [row] = await db
    .select({ storageKey: attachmentsTable.storageKey })
    .from(attachmentsTable)
    .where(eq(attachmentsTable.id, attachmentId))
    .limit(1);
  if (!row) {
    return { deletedRow: false, deletedObject: false };
  }
  await db.delete(attachmentsTable).where(eq(attachmentsTable.id, attachmentId));
  const others = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .where(eq(attachmentsTable.storageKey, row.storageKey))
    .limit(1);
  if (others.length === 0) {
    await storage.deleteObject(row.storageKey).catch(() => {});
    return { deletedRow: true, deletedObject: true };
  }
  return { deletedRow: true, deletedObject: false };
}
