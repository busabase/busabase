/**
 * Conversion Cache Service
 *
 * Provides caching for document conversions to avoid repeated conversions.
 * Supports Redis backend with in-memory fallback.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

import crypto from "node:crypto";
import { getCacheRedis } from "./cache-redis";

// =============================================================================
// Types
// =============================================================================

/** Cache entry stored in the cache */
export interface CacheEntry {
  /** Hash of the original file */
  fileHash: string;
  /** URL or path to the converted output */
  outputUrl: string;
  /** When the entry was created */
  createdAt: Date;
  /** When the entry was last accessed */
  accessedAt: Date;
  /** Size of the converted file in bytes */
  fileSize: number;
}

/** Cache statistics */
export interface CacheStats {
  /** Total number of entries in cache */
  totalEntries: number;
  /** Total size of cached files in bytes */
  totalSize: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Cache hit ratio (0-1) */
  hitRatio: number;
}

/** Configuration for the conversion cache */
export interface ConversionCacheConfig {
  /** Default TTL in seconds (default: 24 hours) */
  defaultTtlSeconds: number;
  /** Maximum cache size in bytes (default: 1GB) */
  maxCacheSize: number;
  /** Maximum number of entries (default: 1000) */
  maxEntries: number;
  /** Redis key prefix */
  keyPrefix: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: ConversionCacheConfig = {
  defaultTtlSeconds: 24 * 60 * 60, // 24 hours
  maxCacheSize: 1024 * 1024 * 1024, // 1GB
  maxEntries: 1000,
  keyPrefix: "conv-cache:",
};

// =============================================================================
// In-Memory LRU Cache Implementation
// =============================================================================

interface MemoryCacheEntry extends CacheEntry {
  expiresAt: number;
}

class LRUCache {
  private cache: Map<string, MemoryCacheEntry> = new Map();
  private readonly maxEntries: number;
  private readonly maxSize: number;
  private currentSize = 0;
  private hits = 0;
  private misses = 0;

  constructor(maxEntries: number, maxSize: number) {
    this.maxEntries = maxEntries;
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    entry.accessedAt = new Date();
    this.cache.set(key, entry);
    this.hits++;

    return {
      fileHash: entry.fileHash,
      outputUrl: entry.outputUrl,
      createdAt: entry.createdAt,
      accessedAt: entry.accessedAt,
      fileSize: entry.fileSize,
    };
  }

  set(key: string, entry: CacheEntry, ttlSeconds: number): void {
    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key) as CacheEntry;
      this.currentSize -= existing.fileSize;
      this.cache.delete(key);
    }

    // Evict entries if needed
    this.evictIfNeeded(entry.fileSize);

    const memoryEntry: MemoryCacheEntry = {
      ...entry,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
    };

    this.cache.set(key, memoryEntry);
    this.currentSize += entry.fileSize;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.fileSize;
      this.cache.delete(key);
      return true;
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      totalEntries: this.cache.size,
      totalSize: this.currentSize,
      hits: this.hits,
      misses: this.misses,
      hitRatio: total > 0 ? this.hits / total : 0,
    };
  }

  private evictIfNeeded(newEntrySize: number): void {
    // Evict expired entries first
    this.evictExpired();

    // Evict LRU entries if still over limits
    while (
      (this.cache.size >= this.maxEntries || this.currentSize + newEntrySize > this.maxSize) &&
      this.cache.size > 0
    ) {
      // Get the first (oldest) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.delete(firstKey);
      }
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this.delete(key);
      }
    }
  }

  /** Cleanup expired entries - can be called periodically */
  cleanup(): number {
    const sizeBefore = this.cache.size;
    this.evictExpired();
    return sizeBefore - this.cache.size;
  }
}

// =============================================================================
// Conversion Cache Class
// =============================================================================

export class ConversionCache {
  private readonly config: ConversionCacheConfig;
  private readonly memoryCache: LRUCache;
  private redisConnected = false;

  constructor(config: Partial<ConversionCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memoryCache = new LRUCache(this.config.maxEntries, this.config.maxCacheSize);
  }

  /**
   * Generate a cache key from file content hash
   * Requirements: 3.1 - Store converted documents using original file hash as key
   */
  static generateCacheKey(fileBuffer: Buffer): string {
    return crypto.createHash("sha256").update(fileBuffer).digest("hex");
  }

  /**
   * Generate a cache key from file URL and metadata
   * Alternative method when file content is not available
   */
  static generateCacheKeyFromUrl(fileUrl: string, fileName: string, fileSize: number): string {
    const data = `cache:${fileUrl}:${fileName}:${fileSize}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Get a cached conversion result
   * Requirements: 3.2 - Check for existing conversions before starting new ones
   */
  async get(fileHash: string): Promise<string | null> {
    const redis = getCacheRedis();
    const redisKey = this.getRedisKey(fileHash);

    // Try Redis first
    if (redis) {
      try {
        if (!redis.isOpen && !this.redisConnected) {
          await redis.connect();
          this.redisConnected = true;
        }

        const data = await redis.get(redisKey);
        if (data) {
          const entry: CacheEntry = JSON.parse(data);
          // Update access time
          entry.accessedAt = new Date();
          await redis.set(redisKey, JSON.stringify(entry), { KEEPTTL: true });
          return entry.outputUrl;
        }
      } catch {
        // Fall through to memory cache
      }
    }

    // Fallback to memory cache
    const entry = this.memoryCache.get(fileHash);
    return entry?.outputUrl ?? null;
  }

  /**
   * Store a conversion result in cache
   * Requirements: 3.3 - Implement TTL for cached conversions
   */
  async set(fileHash: string, outputUrl: string, fileSize = 0, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;
    const now = new Date();

    const entry: CacheEntry = {
      fileHash,
      outputUrl,
      createdAt: now,
      accessedAt: now,
      fileSize,
    };

    const redis = getCacheRedis();
    const redisKey = this.getRedisKey(fileHash);

    // Try Redis first
    if (redis) {
      try {
        if (!redis.isOpen && !this.redisConnected) {
          await redis.connect();
          this.redisConnected = true;
        }

        if (ttl > 0) {
          await redis.set(redisKey, JSON.stringify(entry), { EX: ttl });
        } else {
          await redis.set(redisKey, JSON.stringify(entry));
        }
        return;
      } catch {
        // Fall through to memory cache
      }
    }

    // Fallback to memory cache with LRU eviction
    // Requirements: 3.6 - Implement LRU eviction when storage is limited
    this.memoryCache.set(fileHash, entry, ttl);
  }

  /**
   * Invalidate a cached conversion
   */
  async invalidate(fileHash: string): Promise<void> {
    const redis = getCacheRedis();
    const redisKey = this.getRedisKey(fileHash);

    // Try Redis first
    if (redis) {
      try {
        if (!redis.isOpen && !this.redisConnected) {
          await redis.connect();
          this.redisConnected = true;
        }
        await redis.del(redisKey);
      } catch {
        // Continue to memory cache
      }
    }

    // Also remove from memory cache
    this.memoryCache.delete(fileHash);
  }

  /**
   * Cleanup expired entries
   * Requirements: 3.5 - Provide cache cleanup capabilities
   */
  async cleanup(): Promise<number> {
    // Memory cache cleanup
    const cleaned = this.memoryCache.cleanup();

    // Redis handles TTL expiration automatically
    return cleaned;
  }

  /**
   * Get cache statistics
   * Requirements: 3.5 - Provide cache statistics
   */
  getStats(): CacheStats {
    return this.memoryCache.getStats();
  }

  /**
   * Check if a conversion exists in cache
   * Requirements: 3.2 - Check for existing conversions before starting new ones
   */
  async has(fileHash: string): Promise<boolean> {
    const result = await this.get(fileHash);
    return result !== null;
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    const redis = getCacheRedis();

    // Clear Redis entries with our prefix
    if (redis) {
      try {
        if (!redis.isOpen && !this.redisConnected) {
          await redis.connect();
          this.redisConnected = true;
        }

        // Scan and delete all keys with our prefix
        // Note: Redis SCAN cursor must be a string for compatibility
        const pattern = `${this.config.keyPrefix}*`;
        let cursor = "0";
        do {
          const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
          cursor = String(result.cursor);
          if (result.keys.length > 0) {
            await redis.del(result.keys);
          }
        } while (cursor !== "0");
      } catch {
        // Continue to memory cache
      }
    }

    // Clear memory cache
    this.memoryCache.clear();
  }

  private getRedisKey(fileHash: string): string {
    return `${this.config.keyPrefix}${fileHash}`;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let cacheInstance: ConversionCache | null = null;

/**
 * Get the singleton conversion cache instance
 */
export function getConversionCache(config?: Partial<ConversionCacheConfig>): ConversionCache {
  if (!cacheInstance) {
    cacheInstance = new ConversionCache(config);
  }
  return cacheInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetConversionCache(): void {
  cacheInstance = null;
}
