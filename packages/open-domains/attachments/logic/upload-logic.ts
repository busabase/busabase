/**
 * Attachments upload logic (open-domains) — auth-agnostic, transport-neutral.
 *
 * Any MIME type allowed, 200MB
 * cap, and throws `ORPCError` (all consumers are oRPC). Pure `(input, userId,
 * db, table)` — no auth/billing/context coupling. Hosts pass their own db,
 * userId (real id or "local"), and the `attachments` table instance.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { extractFileExtension, storage } from "openlib/storage";
import type { attachments } from "../schema/attachments";

/** Max upload size (200MB). Any MIME type is accepted. */
export const MAX_FILE_SIZE = 200 * 1024 * 1024;

/**
 * Root of the BINARY attachment namespace — the only namespace `requestUploadUrl`
 * ever mints keys under (both the content-addressed `attachments/blobs/sha256/…`
 * shape and the legacy per-owner `attachments/{userId}/{context}/…` fallback), and
 * therefore the only namespace `confirmUpload` is allowed to finalize.
 *
 * Storage holds other, disjoint namespaces written through their OWN, differently
 * privileged endpoints — notably `asset-texts/pending/…` and
 * `asset-texts/blobs/sha256/…` (busabase-core's Drive text slots, mintable with
 * only per-asset write permission). Without this prefix check a caller could take
 * a key minted by a cheap endpoint and register it as an attachment through the
 * more privileged confirm endpoint, i.e. cross the namespaces. Mirrors the
 * symmetric guard on the text side (`putAssetText`, which rejects anything outside
 * `asset-texts/pending/`).
 */
export const ATTACHMENT_KEY_PREFIX = "attachments";

export const ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS = 3600;

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
 * Accepted shape of a client-supplied fingerprint: optional `sha256:` + 64 hex.
 * Anything else is rejected outright — the hash lands in a storage key.
 */
const CONTENT_HASH_RE = /^(?:sha256:)?[0-9a-f]{64}$/;

/**
 * The per-owner key segment. Owner ids are opaque strings (nanoids, `local`,
 * but also synthetic owners such as `local-node-icon:<nodeId>`), so anything
 * outside a filesystem-safe alphabet is replaced — the local adapter maps keys
 * to paths, and `:` is not a legal path character on Windows.
 */
function ownerSegment(userId: string): string {
  return userId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Content-addressed storage key, namespaced UNDER THE OWNER. The hash is
 * computed by the client and the bytes go straight to the bucket, so the
 * server never verifies it: a key shared across owners would let anyone who
 * knows a file's hash (it is in the file's URL) get a presigned PUT for it and
 * overwrite another user's object. Owner + space scoping keeps new uploads
 * isolated between spaces, and scoped dedup still reuses an existing row —
 * while no caller is ever handed a key that belongs to someone else.
 */
function contentAddressedKey(
  contentHash: string,
  fileName: string,
  userId: string,
  spaceId?: string,
): string {
  const ext = extractFileExtension(fileName);
  const hashHex = contentHash.replace(/^sha256:/, "");
  // Git/OCI-style: algorithm segment + 2-char fan-out (filesystem-friendly for the
  // local adapter; harmless on S3/R2). Keep the extension so direct-serve + the dev
  // proxy infer the right Content-Type (mime is also in the registry row).
  const shard = hashHex.slice(0, 2);
  // Different spaces have independent quota/dedup scopes. A new presign in one
  // must never overwrite a stored object registered in another. Encode the
  // entire opaque id as one segment, including dots to avoid traversal.
  const spacePrefix = spaceId ? `spaces/${encodeURIComponent(spaceId).replace(/\./g, "%2E")}/` : "";
  return `${ATTACHMENT_KEY_PREFIX}/${ownerSegment(userId)}/${spacePrefix}blobs/sha256/${shard}/${hashHex}${ext ? `.${ext}` : ""}`;
}

function assertValidContentHash(contentHash: string | undefined): void {
  if (contentHash !== undefined && !CONTENT_HASH_RE.test(contentHash)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "contentHash must be a hex SHA-256 digest (optionally prefixed with sha256:).",
    });
  }
}

/**
 * Is this key inside the binary attachment namespace this module owns?
 *
 * Rejects `..` segments as well as a wrong prefix: the local storage adapter
 * resolves a key with plain `path.join(rootDir, key)`, so a prefix-only test would
 * be trivially defeated by `attachments/../asset-texts/pending/x.txt`.
 */
function isAttachmentStorageKey(storageKey: string): boolean {
  if (!storageKey.startsWith(`${ATTACHMENT_KEY_PREFIX}/`)) return false;
  return !storageKey.split("/").includes("..");
}

/**
 * Is this a key `requestUploadUrl` would have minted for this owner? Confirming
 * anything else would register another user's object as the caller's own.
 */
function isOwnAttachmentKey(storageKey: string, userId: string): boolean {
  return (
    isAttachmentStorageKey(storageKey) &&
    storageKey.startsWith(`${ATTACHMENT_KEY_PREFIX}/${ownerSegment(userId)}/`)
  );
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

/** Per-host upload policy restrictions; defaults preserve 200MB / any MIME type. */
export interface UploadPolicyOptions {
  /** Tighter max upload size in bytes (default and absolute ceiling: 200MB). */
  maxFileSize?: number;
  /** Allowed MIME types (default: undefined = any type accepted). */
  allowedMimeTypes?: string[];
}

/** Hosts supply differently typed Drizzle clients, including transaction clients. */
export type AttachmentUploadDatabase = any;

export interface RequestAttachmentUploadPolicyArgs {
  input: RequestUploadUrlInput;
  userId: string;
  db: AttachmentUploadDatabase;
  attachmentsTable: typeof attachments;
}

export interface ConfirmAttachmentUploadPolicyArgs {
  input: ConfirmUploadInput;
  userId: string;
  db: AttachmentUploadDatabase;
  attachmentsTable: typeof attachments;
}

/** Optional host policy; shared upload logic does not depend on host billing. */
export interface AttachmentUploadPolicy {
  checkUpload(args: RequestAttachmentUploadPolicyArgs): Promise<void>;
  /** Hosts with garbage collection must never issue a PUT for a retired key. */
  resolveUploadKey?(db: AttachmentUploadDatabase, storageKey: string): Promise<string>;
  confirmUpload(
    args: ConfirmAttachmentUploadPolicyArgs,
    persist: (database: AttachmentUploadDatabase) => Promise<ConfirmUploadResult>,
  ): Promise<ConfirmUploadResult>;
}

const uploadPolicy = new AsyncLocalStorage<AttachmentUploadPolicy>();

/** Object lifetime protection is independent of billing (including trusted uploads). */
export interface AttachmentObjectLifecycle {
  resolveUploadKey(db: AttachmentUploadDatabase, storageKey: string): Promise<string>;
  register<T>(
    db: AttachmentUploadDatabase,
    storageKey: string,
    persist: (database: AttachmentUploadDatabase) => Promise<T>,
  ): Promise<T>;
}

const objectLifecycle = new AsyncLocalStorage<AttachmentObjectLifecycle>();

export function runWithAttachmentObjectLifecycle<T>(
  lifecycle: AttachmentObjectLifecycle,
  fn: () => Promise<T>,
): Promise<T> {
  return objectLifecycle.run(lifecycle, fn);
}

/** Server integrations that register existing objects reuse the active policy. */
export function getAttachmentUploadPolicy(): AttachmentUploadPolicy | undefined {
  return uploadPolicy.getStore();
}

/** Isolate policy to this request and its async descendants, never other hosts. */
export function runWithAttachmentUploadPolicy<T>(
  policy: AttachmentUploadPolicy,
  fn: () => Promise<T>,
): Promise<T> {
  return uploadPolicy.run(policy, fn);
}

/** Trusted server-owned chrome uploads have a separate, non-space lifecycle. */
export function runWithoutAttachmentUploadPolicy<T>(fn: () => Promise<T>): Promise<T> {
  return uploadPolicy.exit(fn);
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
  const maxFileSize = Math.min(opts?.maxFileSize ?? MAX_FILE_SIZE, MAX_FILE_SIZE);
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

  assertValidContentHash(input.contentHash);

  // Authorize the requested scope before returning an existing object's URL.
  // Hosts may allow dedup at capacity, but must still validate space access.
  const policy = uploadPolicy.getStore();
  if (policy) {
    if (!db || !attachmentsTable) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Attachment upload policy requires a database and attachments table.",
      });
    }
    await policy.checkUpload({ input, userId, db, attachmentsTable });
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

  // Content-addressed key when we have a hash (store-once per owner);
  // otherwise the legacy per-owner random key (backward compatible).
  const ext = extractFileExtension(input.fileName);
  const context = input.context || "general";
  let storageKey = input.contentHash
    ? contentAddressedKey(input.contentHash, input.fileName, userId, input.spaceId)
    : `${ATTACHMENT_KEY_PREFIX}/${ownerSegment(userId)}/${context}/${generateNanoID()}${ext ? `.${ext}` : ""}`;

  const lifecycle = objectLifecycle.getStore();
  const resolveUploadKey = lifecycle?.resolveUploadKey ?? policy?.resolveUploadKey;
  if (resolveUploadKey && db) {
    storageKey = await resolveUploadKey(db, storageKey);
  }

  // The storage adapter returns the right target: an s3/r2/minio presign for a
  // direct browser→bucket PUT, or the local dev relay URL carrying ?key=. Either
  // way the client just PUTs the bytes to it — no dev-vs-prod branching.
  const uploadUrl = await storage.generateUploadPresignedUrl(
    storageKey,
    input.mimeType,
    ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS,
    { contentLength: input.sizeBytes },
  );

  return {
    uploadUrl,
    storageKey,
    publicUrl: storage.getPublicUrl(storageKey),
    expiresIn: ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS,
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
  // Namespace guard: `confirmUpload` finalizes an upload that `requestUploadUrl`
  // started, so the key must live in the binary attachment namespace that function
  // mints into. Anything else — most concretely a text-slot key from the far
  // cheaper `createTextUploadUrl` (`asset-texts/pending/…`) — is a caller crossing
  // namespaces, not a legitimate confirm. Checked before the dedup short-circuit
  // so a bad key is rejected outright rather than silently ignored.
  if (!isAttachmentStorageKey(input.storageKey)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `storageKey must be an attachment upload under ${ATTACHMENT_KEY_PREFIX}/ (from createUploadUrl).`,
    });
  }
  // Ownership guard: only a key minted for THIS caller may be finalized —
  // otherwise anyone could claim another user's stored object as their own.
  if (!isOwnAttachmentKey(input.storageKey, userId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "storageKey must be an attachment key issued to you by createUploadUrl.",
    });
  }
  assertValidContentHash(input.contentHash);

  const lifecycle = objectLifecycle.getStore();
  const persist = (database: AttachmentUploadDatabase) =>
    lifecycle
      ? lifecycle.register(database, input.storageKey, (transaction) =>
          persistConfirmedUpload(input, userId, transaction, attachmentsTable),
        )
      : persistConfirmedUpload(input, userId, database, attachmentsTable);
  const policy = uploadPolicy.getStore();
  return policy
    ? policy.confirmUpload({ input, userId, db, attachmentsTable }, persist)
    : persist(db);
}

async function persistConfirmedUpload(
  input: ConfirmUploadInput,
  userId: string,
  db: AttachmentUploadDatabase,
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

  // Retried confirms without a hash must also be idempotent. The host policy
  // can serialize this lookup and insertion inside its quota transaction.
  const scope = input.spaceId
    ? eq(attachmentsTable.spaceId, input.spaceId)
    : eq(attachmentsTable.userId, userId);
  const [existing] = await db
    .select({ id: attachmentsTable.id, storageKey: attachmentsTable.storageKey })
    .from(attachmentsTable)
    .where(and(eq(attachmentsTable.storageKey, input.storageKey), scope))
    .limit(1);
  if (existing) {
    return {
      success: true,
      attachmentId: existing.id,
      storageKey: existing.storageKey,
      publicUrl: storage.getPublicUrl(existing.storageKey),
    };
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
 * Refcount-safe delete. A content-addressed key can be SHARED by many registry
 * rows (scoped dedup, and keys minted before keys were owner-scoped), so the
 * physical object must only be removed once the LAST row referencing that storageKey is gone. Always delete attachments via
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
    try {
      await storage.deleteObject(row.storageKey);
      return { deletedRow: true, deletedObject: true };
    } catch {
      // Callers must not mistake a failed physical deletion for reclaimed bytes.
      return { deletedRow: true, deletedObject: false };
    }
  }
  return { deletedRow: true, deletedObject: false };
}
