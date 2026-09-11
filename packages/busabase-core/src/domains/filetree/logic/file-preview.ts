import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type {
  FilePreviewConfigVO,
  FilePreviewUnavailableReason,
  FilePreviewVO,
} from "busabase-contract/types";
import { cache } from "openlib/cache";
import { storage } from "openlib/storage";
import { z } from "zod";
import {
  emitContextPerformanceMetric,
  type FilePreviewRuntimeConfig,
  getContextFilePreviewConfig,
  getContextSpaceId,
  isEmbedVisitor,
} from "../../../context";
import { hashBuffer } from "../../../logic/kernel";
import {
  type DriveFilePreviewSource,
  readDriveFilePreviewSource,
  resolveFileTreeKind,
} from "../handlers";
import { isBuiltinDrivePreviewSufficient } from "../utils/preview-capability";

const REQUEST_TIMEOUT_MS = 60_000;
// A waiter must outlast the upload it is waiting for: at 20s it reported a
// retryable failure while the lock holder was still legitimately uploading, so
// the second reader of a slow file saw an error that never happened. The lock
// TTL (65s) stays above this so a crashed holder still releases first.
// Deployments behind a gateway with a shorter response budget should lower both
// this and REQUEST_TIMEOUT_MS together rather than just this one.
const DISTRIBUTED_WAIT_MS = REQUEST_TIMEOUT_MS;
const CACHE_MAX_SECONDS = 55 * 60;
const CACHE_EXPIRY_MARGIN_MS = 30_000;
const CACHE_PREFIX = "busabase:file-preview:v1";
/**
 * Process-local sessions are a best-effort mirror of the shared cache, and
 * entries only expire lazily when something reads them again. Without a ceiling
 * a long-lived server would hold every session it ever minted, so the map is
 * bounded and evicts in insertion order once it is full.
 */
const MEMORY_CACHE_MAX_ENTRIES = 500;

const previewFileResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    data: z.object({ previewUrl: z.string().url(), expireAt: z.string().datetime() }),
  }),
  z.object({ previewUrl: z.string().url(), expireAt: z.string().datetime() }),
]);

const cachedPreviewSchema = z.object({
  state: z.literal("ready"),
  provider: z.literal("previewfile"),
  previewUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export interface PreviewFileUploadSource extends DriveFilePreviewSource {
  bytes: Buffer;
  contentHash: string;
}

interface PreviewFileCacheSource extends DriveFilePreviewSource {
  contentHash: string;
}

interface UploadResult {
  result: FilePreviewVO;
  upstreamStatusClass?: "2xx" | "4xx" | "5xx" | "network";
}

interface PreparePreviewDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

const memoryCache = new Map<string, { value: FilePreviewVO; expiresAt: number }>();
const inFlight = new Map<string, Promise<UploadResult>>();

const unavailable = (reason: FilePreviewUnavailableReason, retryable: boolean): FilePreviewVO => ({
  state: "unavailable",
  provider: "previewfile",
  reason,
  retryable,
});

const sizeBucket = (size?: number) => {
  if (size === undefined) return "unknown" as const;
  const mb = 1024 * 1024;
  if (size <= mb) return "0-1mb" as const;
  if (size <= 10 * mb) return "1-10mb" as const;
  if (size <= 50 * mb) return "10-50mb" as const;
  if (size <= 500 * mb) return "50-500mb" as const;
  return "over-500mb" as const;
};

const statusClass = (status: number): "2xx" | "4xx" | "5xx" => {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  return "2xx";
};

const isFreshReadyPreview = (value: FilePreviewVO, now: number): boolean =>
  value.state === "ready" && Date.parse(value.expiresAt) > now + CACHE_EXPIRY_MARGIN_MS;

const previewCacheKey = (
  source: PreviewFileCacheSource,
  config: FilePreviewRuntimeConfig,
): string => {
  const keyFingerprint = createHash("sha256")
    .update(config.apiKey ?? "")
    .digest("hex")
    .slice(0, 16);
  const digest = createHash("sha256")
    .update(
      [
        getContextSpaceId(),
        source.nodeId,
        source.assetId,
        source.contentHash,
        config.baseUrl,
        keyFingerprint,
      ].join("\0"),
    )
    .digest("hex");
  return `${CACHE_PREFIX}:${digest}`;
};

const readCachedPreview = async (key: string, now: number): Promise<FilePreviewVO | null> => {
  const provider = await cache;
  if (provider) {
    try {
      const raw = await provider.get(key);
      if (raw) {
        const parsed = cachedPreviewSchema.safeParse(JSON.parse(raw));
        if (parsed.success && isFreshReadyPreview(parsed.data, now)) return parsed.data;
        await provider.del(key);
      }
    } catch {
      // Cache failure must not prevent a preview from being generated.
    }
  }

  const local = memoryCache.get(key);
  if (!local) return null;
  if (local.expiresAt <= now || !isFreshReadyPreview(local.value, now)) {
    memoryCache.delete(key);
    return null;
  }
  return local.value;
};

const evictExpiredMemoryCache = (now: number): void => {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
  // Still full of live entries: drop the oldest insertions until there is room.
  while (memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next();
    if (oldest.done) return;
    memoryCache.delete(oldest.value);
  }
};

const writeCachedPreview = async (
  key: string,
  value: FilePreviewVO,
  now: number,
): Promise<void> => {
  if (value.state !== "ready") return;
  const secondsUntilExpiry = Math.floor(
    (Date.parse(value.expiresAt) - now - CACHE_EXPIRY_MARGIN_MS) / 1000,
  );
  const ttlSeconds = Math.max(1, Math.min(CACHE_MAX_SECONDS, secondsUntilExpiry));
  if (!memoryCache.has(key) && memoryCache.size >= MEMORY_CACHE_MAX_ENTRIES) {
    evictExpiredMemoryCache(now);
  }
  memoryCache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  try {
    const provider = await cache;
    if (provider) await provider.set(key, JSON.stringify(value), ttlSeconds);
  } catch {
    // In-memory reuse remains available when the shared cache is unhealthy.
  }
};

const readResponsePayload = (payload: z.infer<typeof previewFileResponseSchema>) =>
  "data" in payload ? payload.data : payload;

const validatePreviewUrl = (previewUrl: string, baseUrl: string): boolean => {
  try {
    const preview = new URL(previewUrl);
    const configured = new URL(baseUrl);
    const isConfiguredLocalHttp =
      configured.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname);
    return (
      preview.origin === configured.origin &&
      preview.protocol === configured.protocol &&
      (preview.protocol === "https:" || isConfiguredLocalHttp)
    );
  } catch {
    return false;
  }
};

export const uploadToPreviewFile = async (
  source: PreviewFileUploadSource,
  config: FilePreviewRuntimeConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<UploadResult> => {
  const formData = new FormData();
  // A view over the same memory, not a duplicate: `new Uint8Array(bytes)` copied
  // the whole file, while `new Uint8Array(buffer, offset, length)` shares the
  // allocation. The Blob still snapshots its bytes internally, so this removes
  // one of the resident copies rather than all of them — at the 500MB
  // configurable ceiling that is the copy worth removing. (The cast is only
  // about `Buffer`'s `ArrayBufferLike`; object storage never hands back a
  // `SharedArrayBuffer`, and the view semantics would be identical anyway.)
  const filePart = new Uint8Array(
    source.bytes.buffer as ArrayBuffer,
    source.bytes.byteOffset,
    source.bytes.byteLength,
  );
  formData.append("file", new Blob([filePart], { type: source.mimeType }), source.fileName);
  formData.append("ttlMinutes", String(config.sessionTtlMinutes));
  formData.append("noDownload", "true");
  formData.append("oneTime", "false");

  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/v1/upload", config.baseUrl), {
      method: "POST",
      headers: { "x-api-key": config.apiKey ?? "" },
      body: formData,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      result: unavailable(isTimeout ? "timeout" : "service_unavailable", true),
      upstreamStatusClass: "network",
    };
  }

  const upstreamStatusClass = statusClass(response.status);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { result: unavailable("authentication_failed", false), upstreamStatusClass };
    }
    if (response.status === 413) {
      return { result: unavailable("file_too_large", false), upstreamStatusClass };
    }
    if (response.status === 415 || response.status === 422) {
      return { result: unavailable("unsupported", false), upstreamStatusClass };
    }
    if (response.status === 429) {
      return { result: unavailable("rate_limited", true), upstreamStatusClass };
    }
    return { result: unavailable("service_unavailable", true), upstreamStatusClass };
  }

  try {
    const parsed = previewFileResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { result: unavailable("invalid_response", true), upstreamStatusClass };
    }
    const payload = readResponsePayload(parsed.data);
    if (
      !validatePreviewUrl(payload.previewUrl, config.baseUrl) ||
      Date.parse(payload.expireAt) <= now()
    ) {
      return { result: unavailable("invalid_response", true), upstreamStatusClass };
    }
    return {
      result: {
        state: "ready",
        provider: "previewfile",
        previewUrl: payload.previewUrl,
        expiresAt: payload.expireAt,
      },
      upstreamStatusClass,
    };
  } catch {
    return { result: unavailable("invalid_response", true), upstreamStatusClass };
  }
};

const waitForSharedResult = async (
  key: string,
  now: () => number,
): Promise<FilePreviewVO | null> => {
  const deadline = now() + DISTRIBUTED_WAIT_MS;
  while (now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cached = await readCachedPreview(key, now());
    if (cached) return cached;
  }
  return null;
};

const generateAndCachePreview = async (
  key: string,
  source: PreviewFileCacheSource,
  config: FilePreviewRuntimeConfig,
  dependencies: PreparePreviewDependencies,
  initialBytes?: Buffer,
): Promise<UploadResult> => {
  const now = dependencies.now ?? Date.now;
  const provider = await cache;
  const lockKey = `${key}:lock`;
  const ownerToken = randomUUID();
  let ownsLock = false;

  if (provider) {
    try {
      ownsLock = await provider.acquireLock(lockKey, 65, ownerToken);
      if (!ownsLock) {
        const shared = await waitForSharedResult(key, now);
        // No upstream call happened on this path, so the metric must not claim
        // one: an inherited cache hit is not a 2xx we observed.
        return shared
          ? { result: shared }
          : { result: unavailable("service_unavailable", true), upstreamStatusClass: "network" };
      }
    } catch {
      // Continue with process-local singleflight if the shared cache is unavailable.
    }
  }

  try {
    const bytes = initialBytes ?? (await storage.getObject(source.storageKey));
    const upload = await uploadToPreviewFile({ ...source, bytes }, config, dependencies.fetch, now);
    await writeCachedPreview(key, upload.result, now());
    return upload;
  } finally {
    if (provider && ownsLock) {
      try {
        await provider.releaseLock(lockKey, ownerToken);
      } catch {
        // Expiring lock remains the final safety net.
      }
    }
  }
};

export const getFilePreviewConfiguration = (): FilePreviewConfigVO => {
  const config = getContextFilePreviewConfig();
  return {
    provider: config.provider,
    status: config.configurationError
      ? "invalid_configuration"
      : config.provider === "previewfile" && !config.apiKey
        ? "not_configured"
        : "ready",
    credentialSource: config.credentialSource,
    credentialConfigured: Boolean(config.apiKey),
    maxFileSizeBytes: config.maxFileSizeBytes,
    sessionTtlMinutes: config.sessionTtlMinutes,
    vaultEncryptionConfigured: config.vaultEncryptionConfigured,
  };
};

export const prepareDriveFilePreview = async (
  input: { nodeId: string; filePath: string },
  dependencies: PreparePreviewDependencies = {},
): Promise<FilePreviewVO> => {
  const startedAt = performance.now();
  const config = getContextFilePreviewConfig();
  let fileSize: number | undefined;
  let cacheOutcome: "hit" | "miss" | "none" = "none";
  let upstreamStatusClass: "2xx" | "4xx" | "5xx" | "network" | undefined;

  const finish = (result: FilePreviewVO, metricReason?: string): FilePreviewVO => {
    const reason = result.state === "unavailable" ? result.reason : metricReason;
    emitContextPerformanceMetric(() => ({
      name: "file_preview.prepare",
      provider: result.provider,
      outcome: result.state,
      ...(reason ? { reason } : {}),
      durationMs: Math.round(performance.now() - startedAt),
      cache: cacheOutcome,
      sizeBucket: sizeBucket(fileSize),
      visitorKind: isEmbedVisitor() ? "embed" : "member",
      ...(upstreamStatusClass ? { upstreamStatusClass } : {}),
    }));
    return result;
  };

  // Neither a broken configuration nor a missing credential may take Drive
  // previews down with it. `resolveFilePreviewRuntimeConfig` already
  // substituted safe defaults and warned once, and the resolved status stays
  // `invalid_configuration` / `not_configured` for Settings to show — so serve
  // the built-in preview instead of failing every file into a manual fallback.
  // A misconfiguration is the operator's problem to see in Settings and the
  // logs, not something every reader should have to click through.
  //
  // Never call the provider on a config we could not validate either: a
  // rejected `PREVIEWFILE_BASE_URL` would otherwise send bytes to the public
  // default the operator did not ask for.
  if (config.configurationError) {
    return finish({ state: "builtin", provider: "builtin" }, "invalid_configuration");
  }
  if (config.provider === "builtin") return finish({ state: "builtin", provider: "builtin" });
  if (!config.apiKey) return finish({ state: "builtin", provider: "builtin" }, "not_configured");

  const kind = await resolveFileTreeKind(input.nodeId);
  const source = await readDriveFilePreviewSource(kind, input.nodeId, input.filePath);
  fileSize = source.sizeBytes;
  // The provider escalates past the built-in preview; it does not replace it.
  // Checked before the size limit so a large video the browser plays natively
  // is not reported as too big for a preview it never needed.
  if (isBuiltinDrivePreviewSufficient({ path: source.path, mimeType: source.mimeType })) {
    return finish({ state: "builtin", provider: "builtin" }, "builtin_sufficient");
  }
  if (source.sizeBytes > config.maxFileSizeBytes) {
    return finish(unavailable("file_too_large", false));
  }

  let initialBytes: Buffer | undefined;
  let contentHash = source.contentHash;
  if (!contentHash) {
    initialBytes = await storage.getObject(source.storageKey);
    contentHash = hashBuffer(initialBytes);
  }
  const cacheSource: PreviewFileCacheSource = {
    ...source,
    contentHash,
  };
  const key = previewCacheKey(cacheSource, config);
  const now = dependencies.now ?? Date.now;
  const cached = await readCachedPreview(key, now());
  if (cached) {
    cacheOutcome = "hit";
    return finish(cached);
  }
  cacheOutcome = "miss";

  let promise = inFlight.get(key);
  if (!promise) {
    promise = generateAndCachePreview(key, cacheSource, config, dependencies, initialBytes);
    inFlight.set(key, promise);
    void promise.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    );
  }
  const upload = await promise;
  upstreamStatusClass = upload.upstreamStatusClass;
  return finish(upload.result);
};
