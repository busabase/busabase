/**
 * Attachments upload logic (open-domains) — auth-agnostic, transport-neutral.
 *
 * Any MIME type allowed, 5 GB
 * cap (`ATTACHMENT_MAX_FILE_SIZE`; hosts may tighten it), and throws `ORPCError`
 * (all consumers are oRPC). Pure `(input, userId,
 * db, table)` — no auth/billing/context coupling. Hosts pass their own db,
 * userId (real id or "local"), and the `attachments` table instance.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError } from "@orpc/server";
import { and, desc, eq } from "drizzle-orm";
import { generateNanoID } from "openlib/nanoid";
import { extractFileExtension, type MultipartPart, storage } from "openlib/storage";
import type { attachments } from "../schema/attachments";
import {
  ATTACHMENT_MAX_FILE_SIZE,
  computeMultipartPartSize,
  countMultipartParts,
  FILE_TOO_LARGE_ERROR_CODE,
  type FileTooLargeErrorData,
  fileTooLargeMessage,
  MULTIPART_MAX_PARTS,
  MULTIPART_MAX_SIGN_BATCH,
} from "../utils/file-size";

/**
 * Max upload size (5 GB). Any MIME type is accepted. Defined once, isomorphically,
 * in `../utils/file-size.ts` so the browser's pre-upload check and this
 * authoritative server check can never disagree.
 */
export const MAX_FILE_SIZE = ATTACHMENT_MAX_FILE_SIZE;

/**
 * The one "file too large" error every upload path throws (413). The structured
 * `data` lets clients render a localized message — and, when the host can
 * unlock a bigger limit (`upgradeLimit`), an upgrade action — without parsing
 * English text.
 */
export function createFileTooLargeError(
  data: Omit<FileTooLargeErrorData, "code">,
): ORPCError<"PAYLOAD_TOO_LARGE", FileTooLargeErrorData> {
  return new ORPCError("PAYLOAD_TOO_LARGE", {
    message: fileTooLargeMessage(data.limit),
    data: { code: FILE_TOO_LARGE_ERROR_CODE, ...data },
  });
}

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

/** Per-host upload policy restrictions; defaults preserve 5 GB / any MIME type. */
export interface UploadPolicyOptions {
  /** Tighter max upload size in bytes (default and absolute ceiling: 5 GB). */
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
  /**
   * True when the call registers an object that was ALREADY stored and
   * registered before (e.g. adopting a legacy attachment as an Asset) rather
   * than finalizing a new upload. Hosts still meter it, but per-upload rules
   * such as a per-file size limit apply only to new uploads — files that
   * predate a limit are never retroactively rejected.
   */
  existingObject?: boolean;
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
  /**
   * Optional: do a batch's network checks (object HEAD, billing lookups) up
   * front, before the caller opens the transaction that will run
   * `confirmUpload` for each input. Confirmations inside one transaction keep
   * every earlier row's locks until commit, so per-row network I/O there would
   * hold those locks for the whole batch.
   */
  prepareConfirmations?(inputs: ConfirmUploadInput[]): Promise<void>;
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

type PreparedUpload =
  | { duplicate: true; result: RequestUploadUrlResult }
  | { duplicate: false; storageKey: string };

/**
 * Everything a new upload must pass before any upload target is issued — shared
 * verbatim by the single-PUT (`requestUploadUrl`) and multipart
 * (`createMultipartUpload`) paths, so neither can skip a check the other runs:
 * size ceiling, MIME allowlist, hash shape, the host policy (Cloud: space scope,
 * per-plan per-file limit, storage quota), content-hash dedup, and server-side
 * key minting under `ATTACHMENT_KEY_PREFIX`.
 */
async function prepareUpload(
  input: RequestUploadUrlInput,
  userId: string,
  db: any,
  attachmentsTable: typeof attachments | undefined,
  opts: UploadPolicyOptions | undefined,
): Promise<PreparedUpload> {
  const maxFileSize = Math.min(opts?.maxFileSize ?? MAX_FILE_SIZE, MAX_FILE_SIZE);
  if (input.sizeBytes > maxFileSize) {
    throw createFileTooLargeError({
      limit: maxFileSize,
      sizeBytes: input.sizeBytes,
      fileName: input.fileName,
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
        duplicate: true,
        result: {
          uploadUrl: "",
          storageKey: existing.storageKey,
          publicUrl: storage.getPublicUrl(existing.storageKey),
          expiresIn: 0,
          duplicate: true,
          attachmentId: existing.id,
        },
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
  return { duplicate: false, storageKey };
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
  const prepared = await prepareUpload(input, userId, db, attachmentsTable, opts);
  if (prepared.duplicate) return prepared.result;
  const { storageKey } = prepared;

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

// ── Multipart upload ─────────────────────────────────────────────────────────
//
// For files too large for one request. The SAME `prepareUpload` gate runs at
// create time (so the per-file ceiling, host policy, dedup and server-minted key
// are identical to the single-PUT path); every later step only accepts a key in
// the caller's own attachment namespace; and `completeMultipartUpload`
// re-measures the assembled object with HEAD before registering it, because a
// multipart client is never bound to the size it declared.

export interface CreateMultipartUploadResult {
  storageKey: string;
  publicUrl: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  expiresIn: number;
  duplicate?: boolean;
  attachmentId?: string;
}

export async function createMultipartUpload(
  input: RequestUploadUrlInput,
  userId: string,
  db?: any,
  attachmentsTable?: typeof attachments,
  opts?: UploadPolicyOptions,
): Promise<CreateMultipartUploadResult> {
  const prepared = await prepareUpload(input, userId, db, attachmentsTable, opts);
  if (prepared.duplicate) {
    return {
      storageKey: prepared.result.storageKey,
      publicUrl: prepared.result.publicUrl,
      uploadId: "",
      partSize: 0,
      partCount: 0,
      expiresIn: 0,
      duplicate: true,
      attachmentId: prepared.result.attachmentId,
    };
  }
  const { storageKey } = prepared;
  const partSize = computeMultipartPartSize(input.sizeBytes);
  const uploadId = await storage.createMultipartUpload(storageKey, input.mimeType);
  return {
    storageKey,
    publicUrl: storage.getPublicUrl(storageKey),
    uploadId,
    partSize,
    partCount: countMultipartParts(input.sizeBytes, partSize),
    expiresIn: ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS,
    duplicate: false,
  };
}

export interface MultipartUploadRef {
  storageKey: string;
  uploadId: string;
  spaceId?: string;
}

/**
 * Every follow-up multipart step acts on a key `createMultipartUpload` minted
 * for THIS caller — never another user's key, never another namespace. (The
 * storage backend additionally binds an uploadId to its key: S3 answers
 * `NoSuchUpload` for a mismatched pair; the local adapter checks its metadata.)
 */
function assertOwnMultipartKey(ref: MultipartUploadRef, userId: string): void {
  if (!isOwnAttachmentKey(ref.storageKey, userId)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "storageKey must be an attachment key issued to you by createMultipartUpload.",
    });
  }
  if (!ref.uploadId || ref.uploadId.length > 1024) {
    throw new ORPCError("BAD_REQUEST", { message: "uploadId is required." });
  }
}

export async function signMultipartUploadParts(
  input: MultipartUploadRef & { partNumbers: number[] },
  userId: string,
): Promise<{ parts: Array<{ partNumber: number; uploadUrl: string }>; expiresIn: number }> {
  assertOwnMultipartKey(input, userId);
  const partNumbers = [...new Set(input.partNumbers)];
  if (partNumbers.length === 0 || partNumbers.length > MULTIPART_MAX_SIGN_BATCH) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Request between 1 and ${MULTIPART_MAX_SIGN_BATCH} part numbers at a time.`,
    });
  }
  if (
    partNumbers.some(
      (partNumber) =>
        !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MULTIPART_MAX_PARTS,
    )
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Part numbers must be integers from 1 to ${MULTIPART_MAX_PARTS}.`,
    });
  }
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      uploadUrl: await storage.getUploadPartPresignedUrl(
        input.storageKey,
        input.uploadId,
        partNumber,
        ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS,
      ),
    })),
  );
  return { parts, expiresIn: ATTACHMENT_UPLOAD_EXPIRES_IN_SECONDS };
}

export interface CompleteMultipartUploadInput extends ConfirmUploadInput {
  uploadId: string;
}

/**
 * Assemble the parts, re-measure the result, then register it exactly like
 * `confirmUpload` (same namespace/ownership guards, same host policy — Cloud
 * re-checks the plan's per-file limit and the storage quota against the HEAD
 * size inside its quota transaction).
 */
export async function completeMultipartUpload(
  input: CompleteMultipartUploadInput,
  userId: string,
  db: any,
  attachmentsTable: typeof attachments,
): Promise<ConfirmUploadResult> {
  assertOwnMultipartKey(input, userId);
  assertValidContentHash(input.contentHash);
  if (input.sizeBytes > MAX_FILE_SIZE) {
    throw createFileTooLargeError({
      limit: MAX_FILE_SIZE,
      sizeBytes: input.sizeBytes,
      fileName: input.fileName,
    });
  }

  // The part list comes from the STORE, never the client: a browser can only
  // read a part's ETag header when the bucket's CORS exposes it — a per-bucket
  // setting outside the app's control (Busabase Cloud's production R2 bucket
  // does not expose it). The stored parts must be exactly 1..N for the
  // declared size, so a missing part fails loudly instead of assembling a
  // truncated file; the HEAD check below still catches oversized parts.
  let parts: MultipartPart[];
  try {
    parts = await storage.listMultipartParts(input.storageKey, input.uploadId);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Failed to read multipart upload: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
  const expectedParts = countMultipartParts(
    input.sizeBytes,
    computeMultipartPartSize(input.sizeBytes),
  );
  if (
    parts.length !== expectedParts ||
    parts.some((part, index) => part.partNumber !== index + 1)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Multipart upload is incomplete: ${parts.length} of ${expectedParts} parts were uploaded.`,
    });
  }

  try {
    await storage.completeMultipartUpload(input.storageKey, input.uploadId, parts);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Failed to complete multipart upload: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }

  // HEAD is authoritative: a multipart client was never bound to the size it
  // declared, so the assembled object must match it AND fit the ceiling before
  // anything is registered — on every host, metered or not.
  const object = await storage.getObjectMetadata(input.storageKey);
  if (!object) {
    throw new ORPCError("BAD_REQUEST", { message: "Uploaded attachment was not found" });
  }
  // Every refusal from here on — size mismatch, the ceiling, or the host
  // policy's plan/quota check inside `confirmUpload` — must also remove the
  // object we just assembled. Otherwise a client could declare a small file,
  // upload a big one, take the refusal, and keep reading the unregistered (and
  // never metered) bytes by key: a bypass of both the per-file limit and the
  // storage quota.
  try {
    if (object.size > MAX_FILE_SIZE) {
      throw createFileTooLargeError({
        limit: MAX_FILE_SIZE,
        sizeBytes: object.size,
        fileName: input.fileName,
      });
    }
    if (object.size !== input.sizeBytes) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Uploaded attachment size does not match the confirmed size",
      });
    }
    const { uploadId: _uploadId, ...confirmInput } = input;
    return await confirmUpload(confirmInput, userId, db, attachmentsTable);
  } catch (error) {
    await deleteUnregisteredObject(db, attachmentsTable, input.storageKey);
    throw error;
  }
}

/**
 * Remove a rejected multipart object — but only when no registry row points at
 * the key (an owner-scoped content-addressed key could already back a row).
 * Best effort, but loud: an orphan left behind is unregistered, unmetered and
 * still readable by whoever holds its key, so a failure here is worth seeing.
 */
async function deleteUnregisteredObject(
  db: any,
  attachmentsTable: typeof attachments,
  storageKey: string,
): Promise<void> {
  try {
    const rows = await db
      .select({ id: attachmentsTable.id })
      .from(attachmentsTable)
      .where(eq(attachmentsTable.storageKey, storageKey))
      .limit(1);
    if (rows.length === 0) await storage.deleteObject(storageKey);
  } catch (error) {
    console.warn("[attachments] Failed to delete a rejected multipart object", storageKey, error);
  }
}

export async function abortMultipartUpload(
  input: MultipartUploadRef,
  userId: string,
): Promise<{ success: boolean }> {
  assertOwnMultipartKey(input, userId);
  try {
    await storage.abortMultipartUpload(input.storageKey, input.uploadId);
    return { success: true };
  } catch {
    // Already completed/aborted/expired — nothing left to clean up.
    return { success: false };
  }
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
