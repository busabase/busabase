/**
 * Putting bytes into a Space's Asset library.
 *
 * The wire protocol is three calls — `assets.createUploadUrl` → PUT the bytes
 * at the presigned URL → `assets.confirm` — plus a dedup short-circuit that
 * skips the middle two when the library already holds these exact bytes.
 * Every caller that wants to attach a file has had to re-derive that sequence
 * from the OpenAPI document, which is how it stays undiscovered: a file tree
 * can hold an image, but nothing in the SDK says so or shows you how.
 *
 * Same reasoning as `putText` one level up: callers should never see the
 * three-step flow.
 */
import type { BusabaseClient } from "./client.js";

/** An uploaded file, as the rest of the SDK needs to refer to it. */
export interface BusabaseUploadedAsset {
  /** What a file-tree operation references. Absent on hosts with no Asset library. */
  assetId?: string;
  /** What a record's attachment cell references. */
  attachmentId: string;
  /** Publicly resolvable URL — safe to embed in Markdown. */
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** `sha256:<hex>`, when this runtime could compute one. */
  contentHash?: string;
}

export interface UploadAssetOptions {
  fileName: string;
  mimeType: string;
  /** Optional grouping hint the server records alongside the asset. */
  context?: string;
  spaceId?: string;
}

/** The slice of the client an upload needs — keeps this testable with a stub. */
export type AssetUploadClient = Pick<BusabaseClient, "assets">;

/**
 * SHA-256 of the bytes, or `undefined` where WebCrypto is unavailable.
 *
 * Undefined is a real answer, not a failure: the hash only buys deduplication,
 * so a runtime without WebCrypto uploads the bytes it would otherwise have
 * skipped. Failing the upload over a missing optimization would be worse.
 */
export async function hashBytes(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await subtle.digest("SHA-256", buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/**
 * Upload bytes and get back every id the rest of the SDK might need.
 *
 * @example
 * ```ts
 * const asset = await uploadAsset(client, png, {
 *   fileName: "user-journey.png",
 *   mimeType: "image/png",
 * });
 * // asset.assetId  -> reference it from a Skill/Drive/AirApp file operation
 * // asset.url      -> embed it in Markdown
 * ```
 */
export async function uploadAsset(
  client: AssetUploadClient,
  bytes: Uint8Array,
  options: UploadAssetOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<BusabaseUploadedAsset> {
  const { fileName, mimeType, context, spaceId } = options;
  if (!bytes.byteLength) {
    // The contract requires a positive `sizeBytes`, so an empty file fails
    // server-side with a schema error that says nothing about which file.
    throw new Error(`uploadAsset: ${fileName} is empty — there are no bytes to upload`);
  }
  const contentHash = await hashBytes(bytes);
  const upload = await client.assets.createUploadUrl({
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    ...(context ? { context } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...(contentHash ? { contentHash } : {}),
  });

  // The library already holds these exact bytes: no PUT, no confirm. Skipping
  // is not an optimization here — `uploadUrl` is empty in this response, so
  // trying to upload anyway is an error, not a slower success.
  if (upload.duplicate && upload.attachmentId) {
    return {
      ...(upload.assetId ? { assetId: upload.assetId } : {}),
      attachmentId: upload.attachmentId,
      url: upload.publicUrl,
      fileName,
      mimeType,
      size: bytes.byteLength,
      ...(contentHash ? { contentHash } : {}),
    };
  }

  const response = await fetchImpl(upload.uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType },
    // Not `BodyInit`: that global only exists where the DOM lib is loaded, and
    // packages consuming this SDK typecheck without it. `RequestInit["body"]`
    // resolves in both, and Uint8Array is a valid body either way.
    body: bytes as unknown as RequestInit["body"],
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `uploadAsset: presigned upload of ${fileName} failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
    );
  }

  const confirmed = await client.assets.confirm({
    storageKey: upload.storageKey,
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    ...(context ? { context } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...(contentHash ? { contentHash } : {}),
  });
  return {
    ...(confirmed.assetId ? { assetId: confirmed.assetId } : {}),
    attachmentId: confirmed.attachmentId,
    url: confirmed.publicUrl,
    fileName,
    mimeType,
    size: bytes.byteLength,
    ...(contentHash ? { contentHash } : {}),
  };
}
