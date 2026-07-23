import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { IStorage, MultipartPart, StorageConfig, StorageObjectMetadata } from "./types";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);
const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);

/**
 * Local file system storage adapter
 *
 * Stores files in a local directory and serves them via a base URL.
 * Ideal for development and testing environments where S3 is overkill or unavailable.
 */
export class LocalStorage implements IStorage {
  private rootDir: string;
  private baseUrl: string;

  constructor(config: StorageConfig) {
    this.rootDir = config.localRoot || path.join(process.cwd(), ".uploads");
    this.baseUrl = config.localBaseUrl || "/uploads";

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
   * the host app's dev relay (`openlib/storage/dev-routes` PUT handler) as the
   * upload URL. The key travels in the query string.
   */
  async generateUploadPresignedUrl(
    key: string,
    _mimeType: string,
    _expiresIn?: number,
  ): Promise<string> {
    // A root-relative URL: the client resolves it against the host it's already
    // talking to (ordinary URL resolution — no dev-specific knowledge) and PUTs
    // the raw bytes to it exactly as it would an S3 presigned URL. The storage
    // key rides in the query string because the URL is all the client has.
    return `/api/dev/upload?key=${encodeURIComponent(key)}`;
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    const filePath = path.join(this.rootDir, key);
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
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
      if (await this.objectExists(key)) {
        await unlink(filePath);
      }
    } catch (error) {
      console.warn(`Failed to delete local file ${key}:`, error);
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
   * Multipart upload simulation for local storage
   *
   * Since we're on a local filesystem, we can just simulate the multipart process.
   * We'll store parts in a temporary directory and combine them on completion.
   */
  async createMultipartUpload(key: string, _mimeType: string): Promise<string> {
    // Generate a random upload ID
    const uploadId = Math.random().toString(36).substring(2, 15);
    const tempDir = path.join(this.rootDir, ".tmp", "multipart", uploadId);

    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // Save metadata about the upload
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
    // Return a URL that the client can PUT to
    // The handler would write to .tmp/multipart/{uploadId}/{partNumber}
    return `/api/upload/local/part?uploadId=${uploadId}&partNumber=${partNumber}&key=${encodeURIComponent(key)}`;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    const tempDir = path.join(this.rootDir, ".tmp", "multipart", uploadId);
    const destPath = path.join(this.rootDir, key);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(tempDir)) {
      throw new Error("Invalid upload ID or upload expired");
    }

    if (!fs.existsSync(destDir)) {
      await mkdir(destDir, { recursive: true });
    }

    // Sort parts
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    // Open destination file for writing
    const writeStream = fs.createWriteStream(destPath);

    // Append each part
    for (const part of sortedParts) {
      // In a real implementation we would read the part file written by the upload handler
      // We assume the handler writes files named just by the part number
      const partPath = path.join(tempDir, part.partNumber.toString());

      if (fs.existsSync(partPath)) {
        const partData = await readFile(partPath);
        writeStream.write(partData);
      } else {
        writeStream.close();
        throw new Error(`Part ${part.partNumber} missing`);
      }
    }

    writeStream.end();

    // Clean up temp dir
    // Not using recursive rm for safety, manually cleaning known files
    // But since it's inside .tmp, recursive removal is safer
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    const tempDir = path.join(this.rootDir, ".tmp", "multipart", uploadId);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
