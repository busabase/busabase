import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type {
  IStorage,
  MultipartPart,
  StorageConfig,
  StorageObjectMetadata,
  UploadPresignOptions,
} from "./types";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);
const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);
const rename = promisify(fs.rename);

/**
 * Local file system storage adapter
 *
 * Stores files in a local directory and serves them via a base URL.
 * Ideal for development and testing environments where S3 is overkill or unavailable.
 */
export class LocalStorage implements IStorage {
  private rootDir: string;
  private baseUrl: string;
  private uploadUrl: string;

  constructor(config: StorageConfig) {
    this.rootDir = config.localRoot || path.join(process.cwd(), ".uploads");
    this.baseUrl = config.localBaseUrl || "/uploads";
    this.uploadUrl = config.localUploadUrl || "/api/dev/upload";

    // Ensure root directory exists
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  /**
   * Upload file to local storage
   */
  async uploadFileToKey(
    fileBuffer: Buffer,
    key: string,
    _mimeType: string,
  ): Promise<{ key: string; uri: string; publicUrl: string }> {
    const filePath = path.join(this.rootDir, key);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, fileBuffer);

    return {
      key,
      uri: `local://${key}`,
      publicUrl: this.getPublicUrl(key),
    };
  }

  /**
   * Get public URL for a file
   */
  getPublicUrl(key: string): string {
    // Development proxy or direct file access via web server
    // In dev, Next.js can serve from public or we can have an API route
    // Here we assume a base URL mapping to the served directory
    return `${this.baseUrl.replace(/\/$/, "")}/${key}`;
  }

  /**
   * Generate presigned URL for downloading/accessing file
   * For local storage, this is just the public URL as we don't have real "presigned" URLs
   */
  async generatePresignedUrl(
    key: string,
    _expiresIn?: number,
    _options?: {
      responseContentDisposition?: string;
      responseContentType?: string;
    },
  ): Promise<string> {
    // Validate file exists
    if (!(await this.objectExists(key))) {
      throw new Error(`File not found: ${key}`);
    }
    return this.getPublicUrl(key);
  }

  /**
   * Generate presigned URL for uploading file
   *
   * Local storage has no browser-direct PUT target the way S3 does, so we return
   * the host app's upload relay (`openlib/storage/dev-routes` PUT handler) as
   * the upload URL. The key travels in the query string.
   *
   * Where that relay is mounted is configuration (`upload_url` on `STORAGE_URL`
   * → `config.localUploadUrl`), the write-side mirror of `base_url`. Defaults to
   * `/api/dev/upload` for apps that only use local storage in development.
   */
  async generateUploadPresignedUrl(
    key: string,
    _mimeType: string,
    _expiresIn?: number,
    // Nothing to sign on a local relay; callers verify the stored object after
    // the upload instead (see `IStorage.generateUploadPresignedUrl`).
    _options?: UploadPresignOptions,
  ): Promise<string> {
    // A root-relative URL: the client resolves it against the host it's already
    // talking to (ordinary URL resolution — no dev-specific knowledge) and PUTs
    // the raw bytes to it exactly as it would an S3 presigned URL. The storage
    // key rides in the query string because the URL is all the client has.
    return `${this.uploadUrl.replace(/\/$/, "")}?key=${encodeURIComponent(key)}`;
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    const filePath = path.join(this.rootDir, key);
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      // A missing object is an ordinary false result. Permission and I/O
      // errors are not evidence that the object is absent, so keep them visible
      // to callers such as full-fidelity backup.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }

  async getObjectMetadata(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const result = await stat(path.join(this.rootDir, key));
      if (!result.isFile()) return null;
      return {
        key,
        size: result.size,
        lastModified: result.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete object
   */
  async deleteObject(key: string): Promise<void> {
    const filePath = path.join(this.rootDir, key);
    try {
      await unlink(filePath);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Resolve a storage key to its real filesystem path. Only meaningful for
   * `LocalStorage` — lets a caller stream a large object directly (e.g.
   * `node:fs.createReadStream`) without going through `getObject`'s
   * whole-buffer read, when it already knows it's talking to this provider
   * (see `openlib/storage/factory.ts`'s `getLocalStoragePath`).
   */
  getLocalPath(key: string): string {
    return path.join(this.rootDir, key);
  }

  /**
   * Get object content as Buffer
   */
  async getObject(key: string): Promise<Buffer> {
    const filePath = path.join(this.rootDir, key);
    if (!(await this.objectExists(key))) {
      throw new Error(`Object not found: ${key}`);
    }
    return readFile(filePath);
  }

  /**
   * Get a byte range of a file as a Buffer (inclusive `start`/`end`, mirrors
   * HTTP Range semantics) via `fs.createReadStream(path, { start, end })`.
   */
  async getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
    const filePath = path.join(this.rootDir, key);
    if (!(await this.objectExists(key))) {
      throw new Error(`Object not found: ${key}`);
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  /**
   * Copy object
   */
  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const sourcePath = path.join(this.rootDir, sourceKey);
    const destPath = path.join(this.rootDir, destinationKey);
    const destDir = path.dirname(destPath);

    if (!(await this.objectExists(sourceKey))) {
      throw new Error(`Source file not found: ${sourceKey}`);
    }

    if (!fs.existsSync(destDir)) {
      await mkdir(destDir, { recursive: true });
    }

    await copyFile(sourcePath, destPath);
  }

  /**
   * List objects
   * Warning: This is a simple recursive implementation, strictly mostly for dev use
   */
  async listObjects(
    prefix = "",
    _maxKeys?: number,
    _continuationToken?: string,
  ): Promise<{
    objects: Array<{ key: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }> {
    const objects: Array<{ key: string; size: number; lastModified: Date }> = [];
    const _searchDir = path.join(this.rootDir, prefix);

    // If prefix points to a specific file or doesn't look like a dir, adjust
    // Ideally we walk the whole root and filter by prefix, or walk the prefix dir
    // For simplicity, let's just walk the root and filter
    const walk = async (dir: string) => {
      if (!fs.existsSync(dir)) return;

      const files = await readdir(dir, { withFileTypes: true });

      for (const file of files) {
        const resPath = path.join(dir, file.name);
        const relPath = path.relative(this.rootDir, resPath);

        if (file.isDirectory()) {
          await walk(resPath);
        } else {
          // Check prefix match
          if (relPath.startsWith(prefix)) {
            const stats = await stat(resPath);
            objects.push({
              key: relPath,
              size: stats.size,
              lastModified: stats.mtime,
            });
          }
        }
      }
    };

    await walk(this.rootDir);

    return {
      objects,
      isTruncated: false, // Simple implementation doesn't support pagination
    };
  }

  /**
   * Multipart upload for local storage.
   *
   * Parts are written by the host's part relay (`createLocalMultipartPartRoute`
   * in `./dev-routes`, mounted at `<upload_url>/part`) into
   * `.tmp/multipart/{uploadId}/{partNumber}` and concatenated on completion.
   *
   * The uploadId is a 128-bit random capability minted here, server-side, only
   * after the host authorized the upload and fixed its key. The relay can write
   * nothing but part files of an upload that already exists, and only when the
   * key it is given matches the one recorded at creation — the destination key
   * is never taken from the part request.
   */
  private multipartDir(uploadId: string): string {
    if (!LOCAL_MULTIPART_UPLOAD_ID_RE.test(uploadId)) {
      throw new Error("Invalid upload ID");
    }
    return path.join(this.rootDir, ".tmp", "multipart", uploadId);
  }

  private async readMultipartMetadata(
    uploadId: string,
  ): Promise<{ key: string; created: number } | null> {
    try {
      const raw = await readFile(path.join(this.multipartDir(uploadId), "metadata.json"), "utf8");
      const parsed = JSON.parse(raw) as { key?: unknown; created?: unknown };
      if (typeof parsed.key !== "string" || typeof parsed.created !== "number") return null;
      return { key: parsed.key, created: parsed.created };
    } catch {
      return null;
    }
  }

  async createMultipartUpload(key: string, _mimeType: string): Promise<string> {
    const uploadId = randomBytes(16).toString("hex");
    const tempDir = this.multipartDir(uploadId);
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      path.join(tempDir, "metadata.json"),
      JSON.stringify({ key, created: Date.now() }),
    );
    return uploadId;
  }

  async getUploadPartPresignedUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    _expiresIn?: number,
  ): Promise<string> {
    // Root-relative, next to the single-PUT relay (`<upload_url>/part`), so
    // whatever route serves uploads in this deployment also serves parts.
    const params = new URLSearchParams({
      uploadId,
      partNumber: String(partNumber),
      key,
    });
    return `${this.uploadUrl.replace(/\/$/, "")}/part?${params.toString()}`;
  }

  /**
   * Write one part of an existing multipart upload. Rejects an unknown or
   * expired uploadId, a key that does not match the one recorded at creation,
   * an out-of-range part number, and a body over `maxBytes`. Returns the part's
   * MD5 hex digest (what S3 reports as a part ETag).
   */
  async writeMultipartPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: ReadableStream<Uint8Array> | Buffer,
    options: { maxBytes: number },
  ): Promise<{ etag: string; size: number }> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new LocalMultipartError(400, "Invalid part number");
    }
    if (!LOCAL_MULTIPART_UPLOAD_ID_RE.test(uploadId)) {
      throw new LocalMultipartError(404, "Unknown upload");
    }
    const metadata = await this.readMultipartMetadata(uploadId);
    if (!metadata || metadata.key !== key) {
      throw new LocalMultipartError(404, "Unknown upload");
    }
    if (Date.now() - metadata.created > LOCAL_MULTIPART_MAX_AGE_MS) {
      throw new LocalMultipartError(410, "Upload expired");
    }

    const partPath = path.join(this.multipartDir(uploadId), String(partNumber));
    const tempPath = `${partPath}.${randomBytes(6).toString("hex")}.tmp`;
    const hash = createHash("md5");
    let size = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > options.maxBytes) {
          callback(new LocalMultipartError(413, "Part too large"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const source = Buffer.isBuffer(body)
      ? Readable.from([body])
      : Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
    try {
      await pipeline(source, limiter, fs.createWriteStream(tempPath));
      // A retried part replaces the earlier attempt atomically.
      await rename(tempPath, partPath);
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      throw error;
    }
    return { etag: hash.digest("hex"), size };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    const tempDir = this.multipartDir(uploadId);
    const metadata = await this.readMultipartMetadata(uploadId);
    if (!metadata) {
      throw new Error("Invalid upload ID or upload expired");
    }
    if (metadata.key !== key) {
      throw new Error("Upload ID does not belong to this key");
    }

    const destPath = path.join(this.rootDir, key);
    await mkdir(path.dirname(destPath), { recursive: true });

    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    for (const part of sortedParts) {
      if (!fs.existsSync(path.join(tempDir, part.partNumber.toString()))) {
        throw new Error(`Part ${part.partNumber} missing`);
      }
    }

    // Assemble into a temp file and rename, so a reader (or the HEAD check
    // that follows completion) never sees a half-written object.
    const assembling = `${destPath}.${randomBytes(6).toString("hex")}.assembling`;
    const output = fs.createWriteStream(assembling);
    try {
      for (const part of sortedParts) {
        await pipeline(
          fs.createReadStream(path.join(tempDir, part.partNumber.toString())),
          output,
          { end: false },
        );
      }
      await new Promise<void>((resolve, reject) => {
        output.end((error?: Error | null) => (error ? reject(error) : resolve()));
      });
      await rename(assembling, destPath);
    } catch (error) {
      output.destroy();
      await unlink(assembling).catch(() => {});
      throw error;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  /**
   * The finished part files of an upload (in-flight `*.tmp` writes excluded).
   * Local completion concatenates by part number and never checks ETags, so
   * the ETag here is a cheap size marker rather than an MD5 over gigabytes.
   */
  async listMultipartParts(key: string, uploadId: string): Promise<MultipartPart[]> {
    const metadata = await this.readMultipartMetadata(uploadId);
    if (!metadata || metadata.key !== key) {
      throw new Error("Upload ID does not belong to this key");
    }
    const tempDir = this.multipartDir(uploadId);
    const parts: MultipartPart[] = [];
    for (const name of await readdir(tempDir)) {
      if (!/^\d+$/.test(name)) continue;
      const { size } = await stat(path.join(tempDir, name));
      parts.push({ partNumber: Number(name), etag: `local-${size}` });
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    const tempDir = this.multipartDir(uploadId);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/** Shape of an uploadId minted by `LocalStorage.createMultipartUpload`. */
export const LOCAL_MULTIPART_UPLOAD_ID_RE = /^[0-9a-f]{32}$/;

/** A local multipart upload accepts parts for at most a day after creation. */
export const LOCAL_MULTIPART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Error with the HTTP status the part relay should answer with. */
export class LocalMultipartError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LocalMultipartError";
  }
}
