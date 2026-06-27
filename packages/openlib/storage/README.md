# Sharelib Storage

共享的 S3 存储模块，支持 MinIO、AWS S3、Cloudflare R2 等 S3 兼容存储服务。

## 📦 安装

```bash
# 在你的 app 中添加依赖
pnpm add sharelib@workspace:*
```

## 🚀 快速开始

### 1. 配置环境变量 (DSN 格式)

```bash
# .env.development (MinIO)
STORAGE_DSN="minio://minioadmin:minioadmin@127.0.0.1:9000/mybucket?ssl=false&auto_create=true"

# .env.production (AWS S3)
STORAGE_DSN="s3://AKIAIOSFODNN7EXAMPLE:secretkey@s3.amazonaws.com/mybucket?region=us-west-2"

# .env.production (Cloudflare R2)
STORAGE_DSN="r2://accesskey:secretkey@account.r2.cloudflarestorage.com/mybucket"
```

**DSN 格式说明:**
- `provider://` - 支持 `minio://`, `s3://`, `r2://`
- `accessKey:secretKey` - 访问凭证
- `@endpoint[:port]` - 服务器地址（port 可选）
- `/bucket` - Bucket 名称
- `?params` - 可选参数: `ssl=false`, `region=us-east-1`, `force_path_style=true`, `auto_create=true`

### 2. 使用便捷函数

```typescript
import { uploadFileToS3, getFileAccessUrl } from 'sharelib/storage';

// 上传文件
const { key, uri } = await uploadFileToS3(
  fileBuffer,
  'report.pdf',
  'application/pdf'
);
// 返回: { key: 'uploads/abc123.pdf', uri: 's3://mybucket/uploads/abc123.pdf' }

// 从 S3 URI 生成访问 URL
const accessUrl = await getFileAccessUrl(uri, 3600);
```

### 3. 使用类实例（推荐）

```typescript
import { S3Storage } from 'sharelib/storage';

// 自动从 STORAGE_DSN 读取配置
const storage = new S3Storage();

// 或显式传入 DSN
const storage = new S3Storage(process.env.STORAGE_DSN!);

// 上传文件
const { key, uri } = await storage.uploadFile(
  fileBuffer,
  'document.pdf',
  'application/pdf',
  { folder: 'reports' }
);

// 生成预签名 URL
const presignedUrl = await storage.generatePresignedUrl(key, 3600);

// 从 S3 URI 获取文件访问 URL
const accessUrl = await storage.getFileAccessUrl(uri, 1800);
```

## 📖 API 文档

### `parseStorageDSN(dsn: string): StorageConfig`

解析 STORAGE_DSN 环境变量。

**参数**：
- `dsn`: DSN 连接字符串

**返回**：`StorageConfig` 对象

**示例**：
```typescript
const config = parseStorageDSN('minio://key:secret@127.0.0.1:9000/mybucket?ssl=false');
// {
//   accessKeyId: 'key',
//   secretAccessKey: 'secret',
//   endpoint: 'http://127.0.0.1:9000',
//   bucketName: 'mybucket',
//   region: 'us-east-1',
//   forcePathStyle: true,
//   autoCreateBucket: false
// }
```

### `S3Storage` 类

#### 构造函数

```typescript
// 从 STORAGE_DSN 环境变量读取
const storage = new S3Storage();

// 显式传入 DSN
const storage = new S3Storage('minio://key:secret@host:port/bucket');

// 传入配置对象
const storage = new S3Storage({
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  endpoint: 'http://127.0.0.1:9000',
  bucketName: 'mybucket',
  region: 'us-east-1',
  forcePathStyle: true,
  autoCreateBucket: true,
});
```

#### `uploadFile(fileBuffer, fileName, mimeType, options?)`

上传文件到 S3。

**参数**：
- `fileBuffer`: Buffer - 文件内容
- `fileName`: string - 文件名
- `mimeType`: string - MIME 类型
- `options?`: 可选配置
  - `folder?`: string - 存储文件夹（默认 'uploads'）
  - `generateUniqueKey?`: boolean - 是否生成唯一 key（默认 true）

**返回**：
```typescript
Promise<{
  key: string;      // S3 对象 key
  uri: string;      // 标准 S3 URI (s3://bucket/key)
}>
```

**示例**：
```typescript
// 默认上传（uploads/ 文件夹，自动生成唯一名称）
const result = await storage.uploadFile(buffer, 'report.pdf', 'application/pdf');
// { key: 'uploads/gpHHJ1W1eEEU.pdf', uri: 's3://mybucket/uploads/gpHHJ1W1eEEU.pdf' }

// 指定文件夹
const result = await storage.uploadFile(
  buffer, 
  'Q3-report.pdf', 
  'application/pdf',
  { folder: 'reports' }
);
// { key: 'reports/a1b2c3d4e5f6.pdf', uri: 's3://mybucket/reports/a1b2c3d4e5f6.pdf' }

// 保持原文件名（不生成唯一 key）
const result = await storage.uploadFile(
  buffer,
  'original.pdf',
  'application/pdf',
  { folder: 'documents', generateUniqueKey: false }
);
// { key: 'documents/original.pdf', uri: 's3://mybucket/documents/original.pdf' }
```

#### `generatePresignedUrl(key, expiresIn?)`

生成预签名 URL（用于临时访问私有文件）。

**参数**：
- `key`: string - S3 对象 key
- `expiresIn?`: number - 过期时间（秒），默认 3600（1 小时）

**返回**：`Promise<string>` - 预签名 URL

**示例**：
```typescript
// 生成 1 小时有效的 URL
const url = await storage.generatePresignedUrl('uploads/abc123.pdf');

// 生成 30 分钟有效的 URL
const url = await storage.generatePresignedUrl('uploads/abc123.pdf', 1800);
```

#### `getFileAccessUrl(s3Uri, expiresIn?)`

从 S3 URI 获取文件访问 URL。

**参数**：
- `s3Uri`: string - 标准 S3 URI (s3://bucket/key)
- `expiresIn?`: number - 过期时间（秒），默认 3600

**返回**：`Promise<string>` - 预签名 URL

**示例**：
```typescript
const s3Uri = 's3://mybucket/uploads/abc123.pdf';
const accessUrl = await storage.getFileAccessUrl(s3Uri, 3600);
// 返回：https://mybucket.s3.amazonaws.com/uploads/abc123.pdf?X-Amz-Algorithm=...
```

#### `static extractKeyFromUrl(uri)`

从 S3 URI 提取 key。

**参数**：
- `uri`: string - 标准 S3 URI

**返回**：`string | null` - key 或 null

**示例**：
```typescript
const key = S3Storage.extractKeyFromUrl('s3://mybucket/uploads/abc123.pdf');
// 返回: 'uploads/abc123.pdf'
```

#### `getBucketName()`

获取当前配置的 bucket 名称。

**返回**：`string` - bucket 名称

#### `getConfig()`

获取完整的存储配置。

**返回**：`Readonly<StorageConfig>` - 配置对象

### 便捷函数

#### `getS3Storage(storageUrl?)`

获取单例 S3Storage 实例。

**参数**：
- `storageUrl?`: string - 可选的 DSN，默认使用 `process.env.STORAGE_DSN`

**返回**：`S3Storage` 实例

#### `uploadFileToS3(fileBuffer, fileName, mimeType)`

便捷上传函数（使用单例实例）。

**返回**：`Promise<{ key: string; uri: string }>`

#### `generatePresignedUrl(key, expiresIn?)`

便捷生成预签名 URL 函数（使用单例实例）。

#### `extractKeyFromS3Uri(uri)`

#### `extractKeyFromS3Uri(uri)`

便捷提取 key 函数。

#### `getFileAccessUrl(s3Uri, expiresIn?)`

便捷生成访问 URL 函数（使用单例实例）。

## 🔧 配置示例

### MinIO (本地开发)

```bash
# 带端口号
STORAGE_DSN="minio://minioadmin:minioadmin@127.0.0.1:9000/mybucket?ssl=false&auto_create=true"

# 不带端口号（使用默认 80/443）
STORAGE_DSN="minio://minioadmin:minioadmin@minio.local/mybucket?ssl=false"
```

### AWS S3

```bash
STORAGE_DSN="s3://AKIAIOSFODNN7EXAMPLE:secretkey@s3.amazonaws.com/mybucket?region=us-west-2"
```

### Cloudflare R2

```bash
STORAGE_DSN="r2://access_key:secret_key@account.r2.cloudflarestorage.com/mybucket?region=auto"
```

### 环境变量方式（兼容 AWS SDK）

```bash
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_ENDPOINT_URL=http://127.0.0.1:9000
AWS_REGION=us-east-1
S3_BUCKET=mybucket
S3_FORCE_PATH_STYLE=true
S3_AUTO_CREATE_BUCKET=true
```

## 🔒 安全最佳实践

1. **永远不要在客户端暴露 STORAGE_DSN**
2. **使用预签名 URL 提供临时访问**
3. **设置合理的过期时间**（建议 1 小时内）
4. **启用 auto_create 仅在开发环境**
5. **生产环境手动创建 bucket 并设置权限**
6. **数据库中存储 S3 URI**（`s3://bucket/key`），而不是完整 URL

## 📝 迁移指南

### 从旧的 storage.ts 迁移

如果你的 app 之前使用本地 `storage.ts`，迁移步骤：

1. **安装 sharelib**
   ```bash
   pnpm add sharelib@workspace:*
   ```

2. **更新环境变量**
   ```bash
   # 旧格式 (STORAGE_URL)
   STORAGE_URL="s3://key:secret@127.0.0.1:9000/mybucket?ssl=false"

   # 新格式 (STORAGE_DSN)
   STORAGE_DSN="minio://key:secret@127.0.0.1:9000/mybucket?ssl=false"
   ```

3. **更新导入**
   ```typescript
   // 旧代码
   import { uploadFileToS3 } from '@/server/storage';

   // 新代码
   import { uploadFileToS3 } from 'sharelib/storage';
   ```

4. **更新返回值**
   ```typescript
   // 旧代码
   const { key, url } = await uploadFileToS3(...);
   
   // 新代码
   const { key, uri } = await uploadFileToS3(...);
   ```

5. **删除本地 storage.ts**（可选）
   ```bash
   rm src/server/storage.ts
   ```

4. **或者创建兼容层**
   ```typescript
   // src/server/storage.ts
   export * from 'sharelib/storage';
   ```

## 🧪 测试

```typescript
import { describe, it, expect } from 'vitest';
import { S3Storage } from 'sharelib/storage';

describe('S3Storage', () => {
  const storage = new S3Storage(process.env.STORAGE_URL!);

  it('should upload file', async () => {
    const buffer = Buffer.from('test content');
    const result = await storage.uploadFile(buffer, 'test.txt', 'text/plain');
    
    expect(result.key).toMatch(/^uploads\/[a-zA-Z0-9]{12}\.txt$/);
    expect(result.url).toMatch(/^s3:\/\//);
  });

  it('should generate presigned URL', async () => {
    const url = await storage.generatePresignedUrl('uploads/test.txt', 60);
    
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain('X-Amz-Algorithm');
  });
});
```

## 📄 许可证

Internal use only. Not published to npm.

## 🤝 贡献

请在 monorepo 根目录提交 PR。

---

**维护者**: vikadata/kapps team  
**更新日期**: 2025-10-02
