/**
 * Tests for Conversion Cache Service
 *
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversionCache, getConversionCache, resetConversionCache } from "./conversion-cache";

// =============================================================================
// Test Setup
// =============================================================================

describe("ConversionCache", () => {
  let cache: ConversionCache;

  beforeEach(() => {
    resetConversionCache();
    cache = new ConversionCache({
      defaultTtlSeconds: 60,
      maxCacheSize: 1024 * 1024, // 1MB for tests
      maxEntries: 10,
    });
  });

  afterEach(async () => {
    await cache.clear();
    resetConversionCache();
  });

  // ===========================================================================
  // Cache Key Generation Tests
  // ===========================================================================

  describe("Cache Key Generation", () => {
    it("should generate consistent cache keys for the same file content", () => {
      const buffer = Buffer.from("test file content");
      const key1 = ConversionCache.generateCacheKey(buffer);
      const key2 = ConversionCache.generateCacheKey(buffer);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex length
    });

    it("should generate different cache keys for different file content", () => {
      const buffer1 = Buffer.from("test file content 1");
      const buffer2 = Buffer.from("test file content 2");
      const key1 = ConversionCache.generateCacheKey(buffer1);
      const key2 = ConversionCache.generateCacheKey(buffer2);

      expect(key1).not.toBe(key2);
    });

    it("should generate consistent cache keys from URL metadata", () => {
      const key1 = ConversionCache.generateCacheKeyFromUrl(
        "https://example.com/file.doc",
        "file.doc",
        1024,
      );
      const key2 = ConversionCache.generateCacheKeyFromUrl(
        "https://example.com/file.doc",
        "file.doc",
        1024,
      );

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64);
    });

    it("should generate different cache keys for different URL metadata", () => {
      const key1 = ConversionCache.generateCacheKeyFromUrl(
        "https://example.com/file1.doc",
        "file1.doc",
        1024,
      );
      const key2 = ConversionCache.generateCacheKeyFromUrl(
        "https://example.com/file2.doc",
        "file2.doc",
        1024,
      );

      expect(key1).not.toBe(key2);
    });
  });

  // ===========================================================================
  // Basic Cache Operations Tests
  // ===========================================================================

  describe("Basic Cache Operations", () => {
    it("should store and retrieve cache entries", async () => {
      const fileHash = "abc123";
      const outputUrl = "https://example.com/converted.pdf";

      await cache.set(fileHash, outputUrl, 1024);
      const result = await cache.get(fileHash);

      expect(result).toBe(outputUrl);
    });

    it("should return null for non-existent entries", async () => {
      const result = await cache.get("nonexistent");
      expect(result).toBeNull();
    });

    it("should check if entry exists with has()", async () => {
      const fileHash = "abc123";
      const outputUrl = "https://example.com/converted.pdf";

      expect(await cache.has(fileHash)).toBe(false);
      await cache.set(fileHash, outputUrl);
      expect(await cache.has(fileHash)).toBe(true);
    });

    it("should invalidate cache entries", async () => {
      const fileHash = "abc123";
      const outputUrl = "https://example.com/converted.pdf";

      await cache.set(fileHash, outputUrl);
      expect(await cache.get(fileHash)).toBe(outputUrl);

      await cache.invalidate(fileHash);
      expect(await cache.get(fileHash)).toBeNull();
    });

    it("should clear all cache entries", async () => {
      await cache.set("hash1", "url1");
      await cache.set("hash2", "url2");
      await cache.set("hash3", "url3");

      await cache.clear();

      expect(await cache.get("hash1")).toBeNull();
      expect(await cache.get("hash2")).toBeNull();
      expect(await cache.get("hash3")).toBeNull();
    });
  });

  // ===========================================================================
  // TTL Tests
  // ===========================================================================

  describe("TTL Expiration", () => {
    it("should expire entries after TTL", async () => {
      const shortTtlCache = new ConversionCache({
        defaultTtlSeconds: 1, // 1 second TTL
        maxCacheSize: 1024 * 1024,
        maxEntries: 10,
      });

      const fileHash = "abc123";
      const outputUrl = "https://example.com/converted.pdf";

      await shortTtlCache.set(fileHash, outputUrl, 1024, 1); // 1 second TTL

      // Should exist immediately
      expect(await shortTtlCache.get(fileHash)).toBe(outputUrl);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired
      expect(await shortTtlCache.get(fileHash)).toBeNull();

      await shortTtlCache.clear();
    });

    it("should use default TTL when not specified", async () => {
      const fileHash = "abc123";
      const outputUrl = "https://example.com/converted.pdf";

      await cache.set(fileHash, outputUrl);

      // Should exist with default TTL
      expect(await cache.get(fileHash)).toBe(outputUrl);
    });
  });

  // ===========================================================================
  // LRU Eviction Tests
  // ===========================================================================

  describe("LRU Eviction", () => {
    it("should evict oldest entries when max entries exceeded", async () => {
      const smallCache = new ConversionCache({
        defaultTtlSeconds: 3600,
        maxCacheSize: 1024 * 1024,
        maxEntries: 3,
      });

      // Add 3 entries
      await smallCache.set("hash1", "url1", 100);
      await smallCache.set("hash2", "url2", 100);
      await smallCache.set("hash3", "url3", 100);

      // All should exist
      expect(await smallCache.get("hash1")).toBe("url1");
      expect(await smallCache.get("hash2")).toBe("url2");
      expect(await smallCache.get("hash3")).toBe("url3");

      // Add 4th entry - should evict hash1 (oldest)
      await smallCache.set("hash4", "url4", 100);

      expect(await smallCache.get("hash1")).toBeNull(); // Evicted
      expect(await smallCache.get("hash2")).toBe("url2");
      expect(await smallCache.get("hash3")).toBe("url3");
      expect(await smallCache.get("hash4")).toBe("url4");

      await smallCache.clear();
    });

    it("should evict entries when max size exceeded", async () => {
      const smallCache = new ConversionCache({
        defaultTtlSeconds: 3600,
        maxCacheSize: 300, // 300 bytes max
        maxEntries: 100,
      });

      // Add entries totaling 300 bytes
      await smallCache.set("hash1", "url1", 100);
      await smallCache.set("hash2", "url2", 100);
      await smallCache.set("hash3", "url3", 100);

      // Add large entry - should evict older entries
      await smallCache.set("hash4", "url4", 150);

      // hash1 and hash2 should be evicted to make room
      expect(await smallCache.get("hash1")).toBeNull();
      expect(await smallCache.get("hash2")).toBeNull();
      expect(await smallCache.get("hash3")).toBe("url3");
      expect(await smallCache.get("hash4")).toBe("url4");

      await smallCache.clear();
    });

    it("should update LRU order on access", async () => {
      const smallCache = new ConversionCache({
        defaultTtlSeconds: 3600,
        maxCacheSize: 1024 * 1024,
        maxEntries: 3,
      });

      // Add 3 entries
      await smallCache.set("hash1", "url1", 100);
      await smallCache.set("hash2", "url2", 100);
      await smallCache.set("hash3", "url3", 100);

      // Access hash1 to make it most recently used
      await smallCache.get("hash1");

      // Add 4th entry - should evict hash2 (now oldest)
      await smallCache.set("hash4", "url4", 100);

      expect(await smallCache.get("hash1")).toBe("url1"); // Still exists (was accessed)
      expect(await smallCache.get("hash2")).toBeNull(); // Evicted
      expect(await smallCache.get("hash3")).toBe("url3");
      expect(await smallCache.get("hash4")).toBe("url4");

      await smallCache.clear();
    });
  });

  // ===========================================================================
  // Cache Statistics Tests
  // ===========================================================================

  describe("Cache Statistics", () => {
    it("should track cache hits and misses", async () => {
      await cache.set("hash1", "url1", 100);

      // Hit
      await cache.get("hash1");
      // Miss
      await cache.get("nonexistent");

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRatio).toBe(0.5);
    });

    it("should track total entries and size", async () => {
      await cache.set("hash1", "url1", 100);
      await cache.set("hash2", "url2", 200);

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.totalSize).toBe(300);
    });

    it("should return zero hit ratio when no requests made", () => {
      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(0);
    });
  });

  // ===========================================================================
  // Cleanup Tests
  // ===========================================================================

  describe("Cleanup", () => {
    it("should cleanup expired entries", async () => {
      const shortTtlCache = new ConversionCache({
        defaultTtlSeconds: 1,
        maxCacheSize: 1024 * 1024,
        maxEntries: 10,
      });

      await shortTtlCache.set("hash1", "url1", 100, 1);
      await shortTtlCache.set("hash2", "url2", 100, 3600); // Long TTL

      // Wait for first entry to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const cleaned = await shortTtlCache.cleanup();
      expect(cleaned).toBe(1);

      expect(await shortTtlCache.get("hash1")).toBeNull();
      expect(await shortTtlCache.get("hash2")).toBe("url2");

      await shortTtlCache.clear();
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("Singleton Instance", () => {
    it("should return the same instance", () => {
      resetConversionCache();
      const instance1 = getConversionCache();
      const instance2 = getConversionCache();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton instance", () => {
      const instance1 = getConversionCache();
      resetConversionCache();
      const instance2 = getConversionCache();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("should handle empty file hash", async () => {
      await cache.set("", "url");
      expect(await cache.get("")).toBe("url");
    });

    it("should handle very long URLs", async () => {
      const longUrl = `https://example.com/${"a".repeat(10000)}`;
      await cache.set("hash", longUrl);
      expect(await cache.get("hash")).toBe(longUrl);
    });

    it("should handle updating existing entry", async () => {
      await cache.set("hash", "url1", 100);
      await cache.set("hash", "url2", 200);

      expect(await cache.get("hash")).toBe("url2");

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.totalSize).toBe(200);
    });

    it("should handle zero file size", async () => {
      await cache.set("hash", "url", 0);
      expect(await cache.get("hash")).toBe("url");
    });
  });
});
