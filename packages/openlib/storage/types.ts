/**
 * Represents a part in a multipart upload
 */
export interface MultipartPart {
  partNumber: number;
  etag: string;
}

/**
 * Storage provider type
 */
export type StorageProvider = "s3" | "minio" | "r2" | "local";

/**
 * Common storage configuration
 */
export interface StorageConfig {
  provider?: StorageProvider; // Optional for backward compatibility defaults

  // S3 specific (made optional to support local-only config)
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  bucketName: string; // Required for both (as root folder name for local)
  region?: string;
  forcePathStyle?: boolean;
  autoCreateBucket?: boolean;
  publicBaseUrl?: string; // CDN or public URL base

  // Local specific
  localRoot?: string; // Directory to store files (default: .uploads)
  localBaseUrl?: string; // Base URL for serving local files (default: /uploads)
}

/**
 * Interface for storage adapters
 */
export interface IStorage {
  /**
   * Upload file to storage
   */
  uploadFileToKey(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ key: string; uri: string; publicUrl: string }>;

  /**
   * Get public URL for a file
   */
  getPublicUrl(key: string): string;

  /**
   * Generate presigned URL for downloading/accessing file
   */
  generatePresignedUrl(
    key: string,
    expiresIn?: number,
    options?: {
      responseContentDisposition?: string;
      responseContentType?: string;
    },
  ): Promise<string>;

  /**
   * Generate presigned URL for uploading file (PUT)
   */
  generateUploadPresignedUrl(key: string, mimeType: string, expiresIn?: number): Promise<string>;

  /**
   * Check if object exists
   */
  objectExists(key: string): Promise<boolean>;

  /**
   * Delete object
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Get object content as Buffer
   */
  getObject(key: string): Promise<Buffer>;

  /**
   * Get a byte range of an object as a Buffer (HTTP `Range: bytes=start-end`,
   * inclusive on both ends — mirrors the HTTP Range semantics). Used for
   * ranged reads of large objects (e.g. Drive `readLines`) without loading
   * the whole object into memory.
   */
  getObjectRange(key: string, start: number, end: number): Promise<Buffer>;

  /**
   * Copy object
   */
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;

  /**
   * List objects
   */
  listObjects(
    prefix?: string,
    maxKeys?: number,
    continuationToken?: string,
  ): Promise<{
    objects: Array<{ key: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }>;

  // Multipart upload support (optional or required?)
  // For now let's keep them in the interface but LocalStorage might throw or shim them
  createMultipartUpload(key: string, mimeType: string): Promise<string>;

  getUploadPartPresignedUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<string>;

  completeMultipartUpload(key: string, uploadId: string, parts: MultipartPart[]): Promise<void>;

  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}
