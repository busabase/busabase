import type {
  GetObjectCommandOutput,
  ListObjectsV2CommandOutput,
  S3Client as S3ClientType,
} from "@aws-sdk/client-s3";
import type { IStorage, MultipartPart, StorageConfig } from "./types";

// Lazy-load the AWS SDK. The storage factory STATICALLY imports this module (for
// parseStorageUrl + the S3Storage class), so a top-level `import "@aws-sdk/*"`
// would pull the SDK into the server module graph even for the default LOCAL
// (pglite) storage. Under Next `output: "standalone"` that import is rewritten
// to an unresolvable hashed external (`@aws-sdk/client-s3-<hash>`), which 500s
// every DB/storage request in the npm distribution. Loading it on first S3 use
// instead means local storage never touches @aws-sdk at all.
let _s3SdkPromise: Promise<typeof import("@aws-sdk/client-s3")> | null = null;
const loadS3Sdk = () => {
  _s3SdkPromise ??= import("@aws-sdk/client-s3");
  return _s3SdkPromise;
};
let _presignerPromise: Promise<typeof import("@aws-sdk/s3-request-presigner")> | null = null;
const loadGetSignedUrl = async () => {
  _presignerPromise ??= import("@aws-sdk/s3-request-presigner");
  return (await _presignerPromise).getSignedUrl;
};

/**
 * True for the AWS SDK's "416 Range Not Satisfiable" shape — seen as
 * `error.name === "InvalidRange"` on real S3/MinIO, but different S3-compatible
 * backends (R2, self-hosted MinIO versions) have been observed to only set the
 * HTTP status on `$metadata`/`Code`, so this checks every field the SDK is
 * known to populate rather than trusting a single one.
 */
const isRangeNotSatisfiableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    err.name === "InvalidRange" ||
    err.Code === "InvalidRange" ||
    err.$metadata?.httpStatusCode === 416
  );
};

/**
 * 解析 STORAGE_URL 环境变量
 * 格式: provider://accessKey:secretKey@endpoint[:port]/bucket?params
 *
 * @param url STORAGE_URL 字符串
 * @returns 解析后的配置对象
 *
 * @example
 * ```ts
 * // MinIO (with port)
 * parseStorageUrl("minio://minioadmin:minioadmin@127.0.0.1:9000/mybucket?ssl=false&auto_create=true")
 *
 * // MinIO (without port, uses default 80/443)
 * parseStorageUrl("minio://minioadmin:minioadmin@minio.example.com/mybucket")
 *
 * // AWS S3
 * parseStorageUrl("s3://AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI@s3.amazonaws.com/mybucket?region=us-east-1")
 *
 * // Cloudflare R2
 * parseStorageUrl("r2://key:secret@account.r2.cloudflarestorage.com/mybucket")
 *
 * // Local Storage
 * parseStorageUrl("local:///path/to/uploads?base_url=/uploads")
 * ```
 */
export const parseStorageUrl = (url: string): StorageConfig => {
  if (!url) {
    throw new Error("STORAGE_URL cannot be empty");
  }

  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    throw new Error(
      "Invalid STORAGE_URL format. Expected: provider://accessKey:secretKey@endpoint[:port]/bucket?params",
    );
  }

  const provider = urlObj.protocol.replace(":", "");

  // Local storage support
  if (provider === "local") {
    // For local:// urls:
    // host = empty or ignored
    // pathname = absolute path on disk
    // searchParams = options
    const localRoot = urlObj.pathname;
    const localBaseUrl = urlObj.searchParams.get("base_url") || "/uploads";

    return {
      provider: "local",
      bucketName: "local", // Dummy value for type compatibility, not used by local provider directly
      localRoot,
      localBaseUrl,
    };
  }

  // 支持的 provider
  if (!["s3", "minio", "r2"].includes(provider)) {
    throw new Error(`Unsupported storage provider: ${provider}. Supported: s3, minio, r2, local`);
  }

  // 提取凭证
  const accessKeyId = urlObj.username;
  const secretAccessKey = urlObj.password ? decodeURIComponent(urlObj.password) : "";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing credentials in STORAGE_URL (accessKey:secretKey required)");
  }

  // 提取 bucket
  const bucketName = urlObj.pathname.substring(1); // 去掉开头的 /
  if (!bucketName) {
    throw new Error("Bucket name is required in STORAGE_URL path");
  }

  // Provider-specific defaults
  const providerDefaults = {
    s3: { region: "us-east-1", forcePathStyle: false, defaultSSL: true },
    minio: { region: "us-east-1", forcePathStyle: true, defaultSSL: false },
    r2: { region: "auto", forcePathStyle: false, defaultSSL: true },
  } as const;

  const defaults =
    providerDefaults[provider as keyof typeof providerDefaults] || providerDefaults.s3;

  // 解析 SSL 配置
  const useSSL = urlObj.searchParams.get("ssl") !== "false" && defaults.defaultSSL;

  // 构建 endpoint
  let endpoint: string | undefined;

  if (provider === "s3" && urlObj.hostname === "s3.amazonaws.com") {
    // AWS S3 标准端点，让 SDK 自动处理
    endpoint = undefined;
  } else {
    // 自定义端点 (MinIO/R2/自托管 S3)
    const protocol = useSSL ? "https" : "http";
    const port = urlObj.port; // 如果没有 port，这里是空字符串

    endpoint = port
      ? `${protocol}://${urlObj.hostname}:${port}`
      : `${protocol}://${urlObj.hostname}`;
  }

  // 解析可选参数
  const region = urlObj.searchParams.get("region") || defaults.region;
  const forcePathStyleParam = urlObj.searchParams.get("force_path_style");
  const forcePathStyle =
    forcePathStyleParam != null ? forcePathStyleParam === "true" : defaults.forcePathStyle;
  const autoCreateBucket = urlObj.searchParams.get("auto_create") === "true";

  return {
    provider: provider as "s3" | "minio" | "r2",
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucketName,
    region,
    forcePathStyle,
    autoCreateBucket,
  };
};

/**
 * 从环境变量读取 S3 配置
 * 兼容 AWS SDK 标准环境变量
 *
 * @returns 解析后的配置对象
 *
 * @example
 * ```bash
 * # .env
 * AWS_ACCESS_KEY_ID=minioadmin
 * AWS_SECRET_ACCESS_KEY=minioadmin
 * AWS_ENDPOINT_URL=http://127.0.0.1:9000
 * AWS_REGION=us-east-1
 * S3_BUCKET=mybucket
 * S3_FORCE_PATH_STYLE=true
 * S3_AUTO_CREATE_BUCKET=true
 * ```
 */
export const getStorageConfigFromEnv = (): StorageConfig => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.AWS_ENDPOINT_URL; // 兼容 AWS CLI v2
  const bucketName = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL; // CDN or public S3 URL

  if (!accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "Missing required S3 configuration: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET",
    );
  }

  return {
    provider: "s3",
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucketName,
    region,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    autoCreateBucket: process.env.S3_AUTO_CREATE_BUCKET === "true",
    publicBaseUrl,
  };
};

/**
 * S3 客户端封装类
 */
export class S3Storage implements IStorage {
  private clientPromise: Promise<S3ClientType> | null = null;
  private config: StorageConfig;
  private corsConfigured = false;

  /**
   * 创建 S3Storage 实例
   *
   * @param configOrUrl 配置对象、URL 字符串、或 undefined (从环境变量读取)
   */
  constructor(configOrUrl?: StorageConfig | string) {
    if (typeof configOrUrl === "string") {
      this.config = parseStorageUrl(configOrUrl);
    } else if (configOrUrl) {
      this.config = configOrUrl;
    } else {
      this.config = getStorageConfigFromEnv();
    }

    if (!this.config.accessKeyId || !this.config.secretAccessKey) {
      throw new Error("S3 credentials (accessKeyId, secretAccessKey) are required for S3Storage");
    }
  }

  /** Lazily create (and cache) the S3 client — defers the @aws-sdk load to first use. */
  private getClient(): Promise<S3ClientType> {
    this.clientPromise ??= (async () => {
      const { S3Client } = await loadS3Sdk();
      return new S3Client({
        region: this.config.region,
        endpoint: this.config.endpoint,
        credentials: {
          accessKeyId: this.config.accessKeyId as string,
          secretAccessKey: this.config.secretAccessKey as string,
        },
        forcePathStyle: this.config.forcePathStyle,
      });
    })();
    return this.clientPromise;
  }

  /**
   * Ensure CORS is configured for direct browser upload (called once per instance)
   */
  private async ensureCorsConfigured(): Promise<void> {
    if (this.corsConfigured) return;
    try {
      const { PutBucketCorsCommand } = await loadS3Sdk();
      const client = await this.getClient();
      await client.send(
        new PutBucketCorsCommand({
          Bucket: this.config.bucketName,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ["*"],
                AllowedMethods: ["PUT", "GET", "HEAD"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      // Non-fatal: log and continue (CORS may be managed externally)
      console.warn("[Storage] Failed to set CORS configuration:", error);
    } finally {
      this.corsConfigured = true;
    }
  }

  /**
   * 确保 bucket 存在，不存在则自动创建
   */
  private async ensureBucketExists(): Promise<void> {
    if (!this.config.autoCreateBucket) {
      return;
    }

    const { HeadBucketCommand, CreateBucketCommand } = await loadS3Sdk();
    const client = await this.getClient();
    try {
      await client.send(new HeadBucketCommand({ Bucket: this.config.bucketName }));
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "NotFound" || err.name === "NoSuchBucket") {
        console.log(`Bucket ${this.config.bucketName} does not exist, creating...`);
        try {
          await client.send(new CreateBucketCommand({ Bucket: this.config.bucketName }));
          console.log(`Bucket ${this.config.bucketName} created successfully`);
        } catch (createError: unknown) {
          console.error(`Failed to create bucket ${this.config.bucketName}:`, createError);
          throw createError;
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * 上传文件到指定的 S3 路径（不添加 folder 前缀）
   */
  async uploadFileToKey(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ key: string; uri: string; publicUrl: string }> {
    await this.ensureBucketExists();

    const { PutObjectCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      ACL: undefined, // MinIO 可能不支持 ACL
    });

    await client.send(command);

    // 生成公开访问 URL
    const publicUrl = this.getPublicUrl(key);

    // 返回标准 S3 URI 和公开 URL
    return {
      key,
      uri: `s3://${this.config.bucketName}/${key}`,
      publicUrl,
    };
  }

  /**
   * 生成公开访问 URL
   */
  getPublicUrl(key: string): string {
    // Development: use download proxy
    if (process.env.NODE_ENV === "development") {
      return `/api/dev/attachment/${key}`;
    }

    if (process.env.STORAGE_PUBLIC_BASE_URL) {
      const publicUrl = `${process.env.STORAGE_PUBLIC_BASE_URL}/${key}`;
      return publicUrl;
    }

    // Production: use CDN or S3 direct URL
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }

    // Fallback: generate S3 direct URL
    if (this.config.endpoint) {
      // MinIO or custom endpoint
      return `${this.config.endpoint}/${this.config.bucketName}/${key}`;
    }

    // AWS S3 standard URL
    return `https://${this.config.bucketName}.s3.${this.config.region}.amazonaws.com/${key}`;
  }

  /**
   * 生成预签名 URL（用于临时访问/下载）
   */
  async generatePresignedUrl(
    key: string,
    expiresIn: number = 3600,
    options?: {
      responseContentDisposition?: string;
      responseContentType?: string;
    },
  ): Promise<string> {
    const { GetObjectCommand } = await loadS3Sdk();
    const getSignedUrl = await loadGetSignedUrl();
    const client = await this.getClient();
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ...(options?.responseContentDisposition && {
        ResponseContentDisposition: options.responseContentDisposition,
      }),
      ...(options?.responseContentType && {
        ResponseContentType: options.responseContentType,
      }),
    });

    return await getSignedUrl(client, command, { expiresIn });
  }

  /**
   * 生成上传预签名 URL（用于客户端直接上传）
   */
  async generateUploadPresignedUrl(
    key: string,
    mimeType: string,
    expiresIn: number = 3600,
  ): Promise<string> {
    await this.ensureBucketExists();
    await this.ensureCorsConfigured();

    const { PutObjectCommand } = await loadS3Sdk();
    const getSignedUrl = await loadGetSignedUrl();
    const client = await this.getClient();
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ContentType: mimeType,
    });

    return await getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Initiate a multipart upload
   */
  async createMultipartUpload(key: string, mimeType: string): Promise<string> {
    await this.ensureBucketExists();

    const { CreateMultipartUploadCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new CreateMultipartUploadCommand({
      Bucket: this.config.bucketName,
      Key: key,
      ContentType: mimeType,
    });

    const response = await client.send(command);

    if (!response.UploadId) {
      throw new Error("Failed to initiate multipart upload: no UploadId returned");
    }

    return response.UploadId;
  }

  /**
   * Generate presigned URL for uploading a specific part
   */
  async getUploadPartPresignedUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = 3600,
  ): Promise<string> {
    const { UploadPartCommand } = await loadS3Sdk();
    const getSignedUrl = await loadGetSignedUrl();
    const client = await this.getClient();
    const command = new UploadPartCommand({
      Bucket: this.config.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return await getSignedUrl(client, command, { expiresIn });
  }

  /**
   * Complete a multipart upload
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    // Sort parts by partNumber as required by S3
    const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const { CompleteMultipartUploadCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.config.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
      },
    });

    await client.send(command);
  }

  /**
   * Abort a multipart upload (cleanup)
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const { AbortMultipartUploadCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new AbortMultipartUploadCommand({
      Bucket: this.config.bucketName,
      Key: key,
      UploadId: uploadId,
    });

    await client.send(command);
  }

  /**
   * 从 S3 URI 提取 key
   */
  static extractKeyFromUrl(uri: string): string | null {
    if (!uri.startsWith("s3://")) return null;

    const urlObj = new URL(uri);
    return urlObj.pathname.substring(1); // 去掉开头的 /
  }

  /**
   * 获取文件的临时访问 URL
   */
  async getFileAccessUrl(s3Uri: string, expiresIn?: number): Promise<string> {
    const key = S3Storage.extractKeyFromUrl(s3Uri);
    if (!key) {
      throw new Error("Invalid S3 URI format");
    }

    return await this.generatePresignedUrl(key, expiresIn);
  }

  /**
   * 复制对象（用于将临时文件移动到最终位置）
   */
  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    // S3 requires CopySource to be URL-encoded if it contains non-ASCII characters.
    // The format is "bucket/key". We must NOT double-slash it if sourceKey starts with /
    const cleanSourceKey = sourceKey.startsWith("/") ? sourceKey.substring(1) : sourceKey;
    const copySource = `${this.config.bucketName}/${cleanSourceKey}`;

    const { CopyObjectCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new CopyObjectCommand({
      Bucket: this.config.bucketName,
      CopySource: encodeURI(copySource),
      Key: destinationKey,
    });

    await client.send(command);
  }

  /**
   * Get object content as Buffer
   */
  async getObject(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });
    const response = await client.send(command);
    if (!response.Body) throw new Error(`Object not found: ${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Get a byte range of an object as a Buffer (inclusive `start`/`end`, mirrors
   * HTTP Range semantics) via `Range: bytes=start-end` on `GetObjectCommand`.
   *
   * A range that starts at or past EOF (e.g. `readObjectInChunks`'s
   * next-window probe on an object whose size is an exact multiple of the
   * chunk size, or any range read against a 0-byte object) is a normal,
   * expected shape of a chunked "read until short/empty" loop — S3/R2 answer
   * it with `416 Range Not Satisfiable` (`InvalidRange`), which the SDK
   * surfaces as a thrown error. `LocalStorage.getObjectRange` has no such
   * failure mode (`fs.createReadStream` past EOF just yields nothing), so to
   * keep both providers behaviorally identical for callers, normalize this
   * one specific error into an empty Buffer instead of propagating it.
   */
  async getObjectRange(key: string, start: number, end: number): Promise<Buffer> {
    const { GetObjectCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
      Range: `bytes=${start}-${end}`,
    });
    let response: GetObjectCommandOutput;
    try {
      response = await client.send(command);
    } catch (error: unknown) {
      if (isRangeNotSatisfiableError(error)) {
        return Buffer.alloc(0);
      }
      throw error;
    }
    if (!response.Body) throw new Error(`Object not found: ${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * 删除对象
   */
  async deleteObject(key: string): Promise<void> {
    const { DeleteObjectCommand } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucketName,
      Key: key,
    });

    await client.send(command);
  }

  /**
   * 列出对象（支持前缀过滤和分页）
   */
  async listObjects(
    prefix?: string,
    maxKeys?: number,
    continuationToken?: string,
  ): Promise<{
    objects: Array<{ key: string; size: number; lastModified: Date }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }> {
    const { ListObjectsV2Command } = await loadS3Sdk();
    const client = await this.getClient();
    const command = new ListObjectsV2Command({
      Bucket: this.config.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
      ContinuationToken: continuationToken,
    });

    const response: ListObjectsV2CommandOutput = await client.send(command);

    const objects =
      response.Contents?.map((obj) => ({
        key: obj.Key || "",
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
      })) || [];

    return {
      objects,
      isTruncated: response.IsTruncated || false,
      nextContinuationToken: response.NextContinuationToken,
    };
  }

  /**
   * 检查对象是否存在
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const { GetObjectCommand } = await loadS3Sdk();
      const client = await this.getClient();
      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      });
      await client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取 bucket 名称
   */
  getBucketName(): string {
    return this.config.bucketName;
  }

  /**
   * 获取完整配置
   */
  getConfig(): Readonly<StorageConfig> {
    return { ...this.config };
  }
}

export const generatePresignedUrl = async (
  key: string,
  expiresIn: number = 3600,
  options?: {
    responseContentDisposition?: string;
    responseContentType?: string;
  },
): Promise<string> => {
  const { storage } = await import("./factory");
  return storage.generatePresignedUrl(key, expiresIn, options);
};

export const extractKeyFromS3Uri = (uri: string): string | null => {
  return S3Storage.extractKeyFromUrl(uri);
};

export const getFileAccessUrl = async (s3Uri: string, expiresIn?: number): Promise<string> => {
  const { storage } = await import("./factory");
  const key = extractKeyFromS3Uri(s3Uri);
  if (!key) {
    throw new Error("Invalid S3 URI format");
  }
  return storage.generatePresignedUrl(key, expiresIn);
};
