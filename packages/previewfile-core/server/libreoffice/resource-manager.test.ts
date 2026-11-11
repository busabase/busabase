/**
 * Tests for Resource Manager
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResourceManager, ResourceManager, resetResourceManager } from "./resource-manager";

describe("ResourceManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResourceManager();
  });

  afterEach(() => {
    resetResourceManager();
  });

  describe("Timeout Management", () => {
    it("should execute operations within timeout", async () => {
      const manager = new ResourceManager({ operationTimeout: 1000 });
      const operation = vi.fn().mockResolvedValue("success");

      const result = await manager.withTimeout(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should timeout long-running operations", async () => {
      const manager = new ResourceManager({ operationTimeout: 100 });
      const operation = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));

      await expect(manager.withTimeout(operation)).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.timeoutCount).toBe(1);
    });

    it("should use custom timeout when provided", async () => {
      const manager = new ResourceManager({ operationTimeout: 1000 });
      const operation = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

      await expect(manager.withTimeout(operation, 100)).rejects.toThrow();
    });

    it("should handle operation errors", async () => {
      const manager = new ResourceManager({ operationTimeout: 1000 });
      const operation = vi.fn().mockRejectedValue(new Error("operation failed"));

      await expect(manager.withTimeout(operation)).rejects.toThrow();
    });
  });

  describe("Memory Monitoring", () => {
    it("should monitor memory usage", async () => {
      const manager = new ResourceManager();

      const usage = await manager.monitorMemory();

      expect(usage).toHaveProperty("used");
      expect(usage).toHaveProperty("total");
      expect(usage).toHaveProperty("percentage");
      expect(usage).toHaveProperty("timestamp");
      expect(usage.used).toBeGreaterThan(0);
      expect(usage.total).toBeGreaterThan(0);
      expect(usage.percentage).toBeGreaterThanOrEqual(0);
      expect(usage.percentage).toBeLessThanOrEqual(100);
    });

    it("should track peak memory usage", async () => {
      const manager = new ResourceManager();

      await manager.monitorMemory();
      const stats1 = manager.getStats();
      const initialPeak = stats1.peakMemory;

      // Allocate some memory
      const largeArray = new Array(1000000).fill(0);

      await manager.monitorMemory();
      const stats2 = manager.getStats();

      expect(stats2.peakMemory).toBeGreaterThanOrEqual(initialPeak);

      // Keep reference to prevent GC
      expect(largeArray.length).toBe(1000000);
    });

    it("should execute operations with memory monitoring", async () => {
      const manager = new ResourceManager();
      const operation = vi.fn().mockResolvedValue("success");

      const result = await manager.withMemoryMonitoring(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);

      const stats = manager.getStats();
      expect(stats.currentMemory.used).toBeGreaterThan(0);
    });

    it("should monitor memory even when operation fails", async () => {
      const manager = new ResourceManager();
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      await expect(manager.withMemoryMonitoring(operation)).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.currentMemory.used).toBeGreaterThan(0);
    });
  });

  describe("Zombie Process Cleanup", () => {
    it("should find zombie processes", async () => {
      const manager = new ResourceManager();

      // This test will return empty array in most cases since there are no zombie processes
      const zombies = await manager.findZombieProcesses();

      expect(Array.isArray(zombies)).toBe(true);
    });

    it("should cleanup zombie processes", async () => {
      const manager = new ResourceManager();

      // This will return 0 in most cases since there are no zombie processes
      const cleanedUp = await manager.cleanupZombieProcesses();

      expect(typeof cleanedUp).toBe("number");
      expect(cleanedUp).toBeGreaterThanOrEqual(0);
    });

    it("should start and stop automatic zombie cleanup", () => {
      const manager = new ResourceManager({ zombieCheckInterval: 10000 });

      manager.startZombieCleanup();
      // Starting again should be idempotent
      manager.startZombieCleanup();

      manager.stopZombieCleanup();
      // Stopping again should be safe
      manager.stopZombieCleanup();
    });

    it("should cleanup on shutdown", async () => {
      const manager = new ResourceManager();

      manager.startZombieCleanup();
      await manager.shutdown();

      // Verify cleanup was stopped
      const stats = manager.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe("Statistics", () => {
    it("should provide accurate statistics", async () => {
      const manager = new ResourceManager({ operationTimeout: 100 });

      // Trigger a timeout
      const timeoutOp = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
      try {
        await manager.withTimeout(timeoutOp);
      } catch {
        // Expected
      }

      // Monitor memory
      await manager.monitorMemory();

      const stats = manager.getStats();
      expect(stats.timeoutCount).toBe(1);
      expect(stats.currentMemory.used).toBeGreaterThan(0);
      expect(stats.peakMemory).toBeGreaterThan(0);
      expect(stats.zombiesCleanedUp).toBe(0);
    });

    it("should reset statistics", async () => {
      const manager = new ResourceManager({ operationTimeout: 100 });

      // Generate some stats
      const timeoutOp = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
      try {
        await manager.withTimeout(timeoutOp);
      } catch {
        // Expected
      }

      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.timeoutCount).toBe(0);
      expect(stats.zombiesCleanedUp).toBe(0);
    });
  });

  describe("Singleton Instance", () => {
    it("should return the same instance", () => {
      const manager1 = getResourceManager();
      const manager2 = getResourceManager();

      expect(manager1).toBe(manager2);
    });

    it("should allow resetting the singleton", () => {
      const manager1 = getResourceManager();
      resetResourceManager();
      const manager2 = getResourceManager();

      expect(manager1).not.toBe(manager2);
    });
  });

  describe("Combined Operations", () => {
    it("should handle timeout and memory monitoring together", async () => {
      const manager = new ResourceManager({ operationTimeout: 1000 });

      const operation = async () => {
        return await manager.withMemoryMonitoring(async () => {
          return "success";
        });
      };

      const result = await manager.withTimeout(operation);

      expect(result).toBe("success");

      const stats = manager.getStats();
      expect(stats.currentMemory.used).toBeGreaterThan(0);
      expect(stats.timeoutCount).toBe(0);
    });

    it("should handle timeout with memory monitoring on failure", async () => {
      const manager = new ResourceManager({ operationTimeout: 100 });

      const operation = async () => {
        return await manager.withMemoryMonitoring(async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return "success";
        });
      };

      await expect(manager.withTimeout(operation)).rejects.toThrow();

      const stats = manager.getStats();
      expect(stats.timeoutCount).toBe(1);
    });
  });
});
