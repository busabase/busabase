import "server-only";

import { createHash, type Hash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { isLocalStorageProvider, type LocalStorage, storage } from "openlib/storage";
import {
  assertRestoreBlobReceipt,
  discardRestoreBlobReceipt,
  newRestoreBlobReceipt,
  RESTORE_BLOB_LEASE_MS,
  type RestoreBlobReceipt,
  restoreReceiptPrefix,
  writeRestoreBlobReceipt,
} from "./restore-blob-receipts";

/** Six MiB is an S3-valid part and remains below normal JSON/proxy limits as base64. */
export const RESTORE_BLOB_PART_BYTES = 6 * 1024 * 1024;
const MAX_RESTORE_BLOB_BYTES = 5 * 1024 * 1024 * 1024;

interface BlobChunk {
  partNumber: number;
  totalParts: number;
  sizeBytes: number;
  sha256: string;
}

interface PendingBlob {
  key: string;
  mimeType: string;
  stagingKey: string;
  uploadId: string;
  chunk: BlobChunk;
  nextPart: number;
  receivedBytes: number;
  hash: Hash;
  lastPartHash?: string;
  complete: boolean;
  receiptKey: string;
  receipt: RestoreBlobReceipt;
}

const badRequest = (message: string): never => {
  throw new ORPCError("BAD_REQUEST", { message });
};

const readChunk = (value: unknown): BlobChunk => {
  if (typeof value !== "object" || value === null)
    return badRequest("Missing restore blob chunk metadata");
  const chunk = value as BlobChunk;
  if (
    !Number.isInteger(chunk.partNumber) ||
    chunk.partNumber < 1 ||
    !Number.isInteger(chunk.totalParts) ||
    chunk.totalParts < 1 ||
    chunk.totalParts > 10_000 ||
    chunk.partNumber > chunk.totalParts ||
    !Number.isSafeInteger(chunk.sizeBytes) ||
    chunk.sizeBytes < 0 ||
    chunk.sizeBytes > MAX_RESTORE_BLOB_BYTES ||
    chunk.totalParts !== Math.max(1, Math.ceil(chunk.sizeBytes / RESTORE_BLOB_PART_BYTES)) ||
    typeof chunk.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(chunk.sha256)
  )
    return badRequest("Invalid restore blob chunk metadata");
  return chunk;
};

const decodePart = (base64: unknown): Buffer => {
  if (
    typeof base64 !== "string" ||
    base64.length > 8 * 1024 * 1024 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    return badRequest("Restore blob part must contain at most six MiB of canonical base64 bytes");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64)
    return badRequest("Restore blob part is not canonical base64");
  return bytes;
};

export const assertRestoreBlobKey = (
  key: unknown,
  table: "attachmentBlobs" | "assetTextBlobs",
): string => {
  const prefix = table === "attachmentBlobs" ? "attachments/" : "asset-texts/";
  if (
    typeof key !== "string" ||
    !key.startsWith(prefix) ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.split("/").some((part) => part === ".." || part === "." || !part)
  ) {
    return badRequest("Invalid chunked restore storage key");
  }
  return key;
};

/** Session-bound multipart state. Only small part metadata and incremental hashes stay in memory. */
interface RestoreBlobPartInput {
  key: string;
  mimeType: string;
  base64: unknown;
  chunk: unknown;
  /** true means an already-present object was fully verified; replay must not write it. */
  validate: (sizeBytes: number, sha256: string) => Promise<unknown>;
  promote: (stagingKey: string, sizeBytes: number, sha256: string) => Promise<void>;
}

export class RestoreBlobParts {
  private readonly queues = new Map<string, Promise<boolean>>();
  private readonly blobs = new Map<string, PendingBlob>();
  private readonly reused = new Map<string, { chunk: BlobChunk; mimeType: string }>();

  constructor(
    private readonly sessionId: string,
    private readonly spaceId: string,
  ) {}

  private async discard(blob: PendingBlob): Promise<void> {
    if (blob.complete) return;
    await discardRestoreBlobReceipt(blob.receiptKey, blob.receipt);
  }

  async cleanup(): Promise<void> {
    await Promise.allSettled(this.queues.values());
    for (const blob of this.blobs.values()) {
      try {
        await this.discard(blob);
      } catch (error) {
        console.error("[Dump restore] Could not clean staged multipart object", error);
      }
    }
    this.blobs.clear();
    this.reused.clear();
  }

  hasIncomplete(): boolean {
    return this.queues.size > 0 || [...this.blobs.values()].some((blob) => !blob.complete);
  }

  async accept(input: RestoreBlobPartInput): Promise<boolean> {
    const previous = this.queues.get(input.key) ?? Promise.resolve(false);
    const running = previous.catch(() => false).then(() => this.acceptPart(input));
    this.queues.set(input.key, running);
    try {
      return await running;
    } finally {
      if (this.queues.get(input.key) === running) this.queues.delete(input.key);
    }
  }

  /** Older inline callers receive the same staging, verification and promotion guards. */
  async acceptInline(input: Omit<RestoreBlobPartInput, "chunk">): Promise<boolean> {
    if (typeof input.base64 !== "string" || input.base64.length % 4 !== 0)
      return badRequest("Restore blob is not canonical base64");
    const encoded = input.base64;
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const sizeBytes = (encoded.length / 4) * 3 - padding;
    if (sizeBytes < 0 || sizeBytes > MAX_RESTORE_BLOB_BYTES)
      return badRequest("Restore blob size is outside the supported range");
    const encodedPartBytes = (RESTORE_BLOB_PART_BYTES / 3) * 4;
    const hash = createHash("sha256");
    // Validate all input before creating any provider upload. Decoding one
    // six-MiB slice at a time avoids duplicating an entire legacy object.
    for (let offset = 0; offset < encoded.length; offset += encodedPartBytes) {
      hash.update(decodePart(encoded.slice(offset, offset + encodedPartBytes)));
    }
    const sha256 = hash.digest("hex");
    const totalParts = Math.max(1, Math.ceil(sizeBytes / RESTORE_BLOB_PART_BYTES));
    let complete = false;
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      complete = await this.accept({
        ...input,
        base64: encoded.slice((partNumber - 1) * encodedPartBytes, partNumber * encodedPartBytes),
        chunk: { partNumber, totalParts, sizeBytes, sha256 },
      });
    }
    return complete;
  }

  private async acceptPart(input: RestoreBlobPartInput): Promise<boolean> {
    const chunk = readChunk(input.chunk);
    const bytes = decodePart(input.base64);
    const expectedBytes =
      chunk.partNumber === chunk.totalParts
        ? chunk.sizeBytes - (chunk.totalParts - 1) * RESTORE_BLOB_PART_BYTES
        : RESTORE_BLOB_PART_BYTES;
    if (bytes.length !== expectedBytes)
      return badRequest("Restore blob part size does not match its declared position");
    const partHash = createHash("sha256").update(bytes).digest("hex");
    let blob = this.blobs.get(input.key);
    let reused = this.reused.get(input.key);
    if (!blob && !reused) {
      if (chunk.partNumber !== 1) return badRequest("Restore blob must start with part one");
      if ((await input.validate(chunk.sizeBytes, chunk.sha256)) === true) {
        reused = { chunk, mimeType: input.mimeType };
        this.reused.set(input.key, reused);
      }
    }
    if (reused) {
      if (
        reused.chunk.sha256 !== chunk.sha256 ||
        reused.chunk.sizeBytes !== chunk.sizeBytes ||
        reused.chunk.totalParts !== chunk.totalParts ||
        reused.mimeType !== input.mimeType
      )
        return badRequest("Restore blob metadata changed during verified object replay");
      if (chunk.sizeBytes === 0) {
        const metadata = await storage.getObjectMetadata(input.key);
        if (!metadata || metadata.size !== 0)
          return badRequest("Verified empty restore object changed");
      } else {
        const start = (chunk.partNumber - 1) * RESTORE_BLOB_PART_BYTES;
        const stored = await storage.getObjectRange(input.key, start, start + expectedBytes - 1);
        if (!stored.equals(bytes))
          return badRequest("Replayed restore part differs from the verified existing object");
      }
      return chunk.partNumber === chunk.totalParts;
    }
    if (!blob) {
      if (chunk.partNumber !== 1) return badRequest("Restore blob must start with part one");
      const directory = `${restoreReceiptPrefix(this.spaceId)}${this.sessionId}/${randomBytes(16).toString("hex")}/`;
      const stagingKey = `${directory}object`;
      const uploadId = await storage.createMultipartUpload(stagingKey, input.mimeType);
      const receipt = await newRestoreBlobReceipt(this.spaceId, this.sessionId, uploadId);
      blob = {
        key: input.key,
        mimeType: input.mimeType,
        stagingKey,
        uploadId,
        receiptKey: `${directory}receipt.json`,
        receipt,
        chunk,
        nextPart: 1,
        receivedBytes: 0,
        hash: createHash("sha256"),
        complete: false,
      };
      this.blobs.set(input.key, blob);
    }
    if (
      blob.chunk.sha256 !== chunk.sha256 ||
      blob.chunk.sizeBytes !== chunk.sizeBytes ||
      blob.chunk.totalParts !== chunk.totalParts ||
      blob.mimeType !== input.mimeType
    ) {
      return badRequest("Restore blob metadata changed during multipart upload");
    }
    if (blob.complete) {
      // v1 archives can repeat a physical key once per Asset. A complete replay
      // is safe only when every offered part still matches the stored object;
      // never recreate staging state or overwrite already-verified bytes.
      if (chunk.sizeBytes === 0) {
        const metadata = await storage.getObjectMetadata(blob.key);
        if (!metadata || metadata.size !== 0)
          return badRequest("Replayed empty restore object no longer matches the completed object");
        return true;
      }
      const start = (chunk.partNumber - 1) * RESTORE_BLOB_PART_BYTES;
      const stored = await storage.getObjectRange(blob.key, start, start + expectedBytes - 1);
      if (!stored.equals(bytes))
        return badRequest("Replayed restore blob part differs from the completed object");
      return chunk.partNumber === chunk.totalParts;
    }
    if (chunk.partNumber === blob.nextPart - 1 && partHash === blob.lastPartHash) return false;
    if (chunk.partNumber !== blob.nextPart)
      return badRequest("Restore blob part is out of sequence");

    try {
      blob.receipt.leaseExpiresAt = Date.now() + RESTORE_BLOB_LEASE_MS;
      await writeRestoreBlobReceipt(blob.receiptKey, blob.receipt);
      if (isLocalStorageProvider()) {
        await (storage as unknown as LocalStorage).writeMultipartPart(
          blob.stagingKey,
          blob.uploadId,
          chunk.partNumber,
          bytes,
          { maxBytes: RESTORE_BLOB_PART_BYTES },
        );
      } else {
        const url = await storage.getUploadPartPresignedUrl(
          blob.stagingKey,
          blob.uploadId,
          chunk.partNumber,
        );
        const response = await fetch(url, {
          method: "PUT",
          body: new Uint8Array(bytes),
          headers: {
            "content-type": blob.mimeType,
            "content-md5": createHash("md5").update(bytes).digest("base64"),
          },
        });
        if (!response.ok) throw new Error(`Restore multipart PUT failed (HTTP ${response.status})`);
      }
      blob.hash.update(bytes);
      blob.receivedBytes += bytes.length;
      blob.nextPart++;
      blob.lastPartHash = partHash;
      if (chunk.partNumber !== chunk.totalParts) return false;
      if (
        blob.receivedBytes !== chunk.sizeBytes ||
        blob.hash.copy().digest("hex") !== chunk.sha256
      ) {
        return badRequest("Completed restore blob content hash or size does not match the archive");
      }
      const parts = await storage.listMultipartParts(blob.stagingKey, blob.uploadId);
      if (
        parts.length !== chunk.totalParts ||
        parts.some((part, index) => part.partNumber !== index + 1)
      )
        return badRequest("Stored multipart parts are incomplete");
      await storage.completeMultipartUpload(blob.stagingKey, blob.uploadId, parts);
      const metadata = await storage.getObjectMetadata(blob.stagingKey);
      if (!metadata || metadata.size !== chunk.sizeBytes)
        return badRequest("Completed staged object has the wrong size");
      const storedHash = createHash("sha256");
      for (let offset = 0; offset < chunk.sizeBytes; offset += RESTORE_BLOB_PART_BYTES) {
        const end = Math.min(offset + RESTORE_BLOB_PART_BYTES, chunk.sizeBytes) - 1;
        const part = await storage.getObjectRange(blob.stagingKey, offset, end);
        if (part.length !== end - offset + 1)
          return badRequest("Staged restore object was truncated");
        storedHash.update(part);
      }
      if (storedHash.digest("hex") !== chunk.sha256)
        return badRequest("Stored restore object content hash does not match the archive");
      await input.validate(chunk.sizeBytes, chunk.sha256);
      await assertRestoreBlobReceipt(blob.receiptKey, blob.receipt);
      await input.promote(blob.stagingKey, chunk.sizeBytes, chunk.sha256);
      await storage.deleteObject(blob.stagingKey);
      await storage.deleteObject(blob.receiptKey);
      blob.complete = true;
      return true;
    } catch (error) {
      await this.discard(blob).catch((cleanupError) =>
        console.error("[Dump restore] Could not clean failed multipart", cleanupError),
      );
      this.blobs.delete(input.key);
      throw error;
    }
  }
}
