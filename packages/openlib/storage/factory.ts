import { LocalStorage } from "./local";
import { parseStorageUrl, S3Storage } from "./s3";
import type { IStorage, StorageConfig } from "./types";

let _storage: IStorage | null = null;

function initStorage(configOrUrl?: StorageConfig | string): IStorage {
  if (typeof configOrUrl === "string") {
    return parseStorageUrl(configOrUrl).provider === "local"
      ? new LocalStorage(parseStorageUrl(configOrUrl))
      : new S3Storage(configOrUrl);
  }
  if (configOrUrl) {
    return configOrUrl.provider === "local"
      ? new LocalStorage(configOrUrl)
      : new S3Storage(configOrUrl);
  }
  const url = process.env.STORAGE_URL;
  if (!url) throw new Error("STORAGE_URL environment variable is not set");
  const config = parseStorageUrl(url);
  return config.provider === "local" ? new LocalStorage(config) : new S3Storage(config);
}

/**
 * Lazy-init proxy for the storage instance.
 *
 * Auto-detects provider from STORAGE_URL:
 * - `local:///path?base_url=/uploads` → LocalStorage
 * - `s3://...`, `minio://...`, `r2://...` → S3Storage
 */
export const storage: IStorage = new Proxy({} as IStorage, {
  get(_target, prop) {
    if (!_storage) _storage = initStorage();
    const value = (_storage as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(_storage) : value;
  },
});

/**
 * Create a storage instance with explicit config (bypasses singleton, for testing or multi-tenant)
 */
export const createStorage = (configOrUrl: StorageConfig | string): IStorage =>
  initStorage(configOrUrl);

/**
 * Reset storage singleton (useful for testing)
 */
export const resetStorage = (): void => {
  _storage = null;
};
