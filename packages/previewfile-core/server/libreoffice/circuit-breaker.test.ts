/**
 * Tests for Circuit Breaker
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  getLibreOfficeCircuitBreaker,
  resetLibreOfficeCircuitBreaker,
} from "./circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibreOfficeCircuitBreaker();
  });

  describe("Basic Functionality", () => {
    it("should start in CLOSED state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should execute successful operations in CLOSED state", async () => {
      const breaker = new CircuitBreaker();
      const operation = vi.fn().mockResolvedValue("success");

      const result = await breaker.execute(operation);

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should track successful operations", async () => {
      const breaker = new CircuitBreaker();
      const operation = vi.fn().mockResolvedValue("success");

      await breaker.execute(operation);
      await breaker.execute(operation);

      const stats = breaker.getStats();
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(0);
    });
  });

  describe("Failure Handling", () => {
    it("should track failed operations", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      try {
        await breaker.execute(operation);
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.totalFailures).toBe(1);
      expect(stats.recentFailures).toBe(1);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should open circuit after failure threshold is reached", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3, failureWindow: 10000 });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      // Execute 3 failures to reach threshold
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");
      const stats = breaker.getStats();
      expect(stats.timesOpened).toBe(1);
    });

    it("should reject operations when circuit is OPEN", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      // Trigger circuit to open
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");

      // Try to execute another operation
      const newOperation = vi.fn().mockResolvedValue("success");
      await expect(breaker.execute(newOperation)).rejects.toThrow();
      expect(newOperation).not.toHaveBeenCalled();
    });
  });

  describe("State Transitions", () => {
    it("should transition from OPEN to HALF_OPEN after reset timeout", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100, // 100ms
      });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next operation should transition to HALF_OPEN
      const successOperation = vi.fn().mockResolvedValue("success");
      await breaker.execute(successOperation);

      expect(breaker.getState()).toBe("CLOSED");
      expect(successOperation).toHaveBeenCalledTimes(1);
    });

    it("should transition from HALF_OPEN to CLOSED on success", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100,
      });

      // Open the circuit
      const failOperation = vi.fn().mockRejectedValue(new Error("test error"));
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(failOperation);
        } catch {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute successful operation
      const successOperation = vi.fn().mockResolvedValue("success");
      await breaker.execute(successOperation);

      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should transition from HALF_OPEN to OPEN on failure", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 100,
      });

      // Open the circuit
      const failOperation = vi.fn().mockRejectedValue(new Error("test error"));
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(failOperation);
        } catch {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Execute another failing operation
      try {
        await breaker.execute(failOperation);
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("Failure Window", () => {
    it("should only count failures within the failure window", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        failureWindow: 100, // 100ms window
      });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      // First failure
      try {
        await breaker.execute(operation);
      } catch {
        // Expected
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second failure (first one should be outside window now)
      try {
        await breaker.execute(operation);
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.recentFailures).toBe(1); // Only the recent failure
      expect(breaker.getState()).toBe("CLOSED"); // Should still be closed
    });
  });

  describe("Manual Control", () => {
    it("should allow manual reset", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });
      const operation = vi.fn().mockRejectedValue(new Error("test error"));

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(operation);
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");

      // Manual reset
      breaker.reset();

      expect(breaker.getState()).toBe("CLOSED");
      const stats = breaker.getStats();
      expect(stats.recentFailures).toBe(0);
    });

    it("should allow manual open", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe("CLOSED");

      breaker.open();

      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("Statistics", () => {
    it("should provide accurate statistics", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 });
      const successOp = vi.fn().mockResolvedValue("success");
      const failOp = vi.fn().mockRejectedValue(new Error("test error"));

      // Execute some operations
      await breaker.execute(successOp);
      await breaker.execute(successOp);

      try {
        await breaker.execute(failOp);
      } catch {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.totalSuccesses).toBe(2);
      expect(stats.totalFailures).toBe(1);
      expect(stats.recentFailures).toBe(1);
      expect(stats.state).toBe("CLOSED");
      expect(stats.lastFailureTime).toBeInstanceOf(Date);
      expect(stats.lastStateChange).toBeInstanceOf(Date);
    });
  });

  describe("Singleton Instance", () => {
    it("should return the same instance", () => {
      const breaker1 = getLibreOfficeCircuitBreaker();
      const breaker2 = getLibreOfficeCircuitBreaker();

      expect(breaker1).toBe(breaker2);
    });

    it("should allow resetting the singleton", () => {
      const breaker1 = getLibreOfficeCircuitBreaker();
      resetLibreOfficeCircuitBreaker();
      const breaker2 = getLibreOfficeCircuitBreaker();

      expect(breaker1).not.toBe(breaker2);
    });
  });
});
