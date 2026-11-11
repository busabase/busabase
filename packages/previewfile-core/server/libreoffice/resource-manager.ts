/**
 * Resource Manager for LibreOffice Conversions
 *
 * Handles timeout management, memory monitoring, and zombie process cleanup
 * for document conversion operations.
 *
 * Requirements: 7.2, 7.3, 7.6
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// =============================================================================
// Types
// =============================================================================

/** Configuration for resource management */
export interface ResourceManagerConfig {
  /** Timeout for operations in milliseconds */
  operationTimeout: number;
  /** Memory threshold in bytes for warnings */
  memoryWarningThreshold: number;
  /** Memory threshold in bytes for critical alerts */
  memoryCriticalThreshold: number;
  /** Interval for checking zombie processes in milliseconds */
  zombieCheckInterval: number;
  /** Process name pattern to identify LibreOffice processes */
  processNamePattern: string;
}

/** Memory usage information */
export interface MemoryUsage {
  /** Total memory used in bytes */
  used: number;
  /** Total memory available in bytes */
  total: number;
  /** Percentage of memory used */
  percentage: number;
  /** Timestamp of measurement */
  timestamp: Date;
}

/** Process information */
export interface ProcessInfo {
  /** Process ID */
  pid: number;
  /** Process name */
  name: string;
  /** CPU usage percentage */
  cpu: number;
  /** Memory usage in bytes */
  memory: number;
  /** Process state */
  state: string;
  /** Process start time */
  startTime?: Date;
}

/** Resource monitoring statistics */
export interface ResourceStats {
  /** Current memory usage */
  currentMemory: MemoryUsage;
  /** Peak memory usage recorded */
  peakMemory: number;
  /** Number of timeouts encountered */
  timeoutCount: number;
  /** Number of zombie processes cleaned up */
  zombiesCleanedUp: number;
  /** Active LibreOffice processes */
  activeProcesses: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: ResourceManagerConfig = {
  operationTimeout: 30000, // 30 seconds
  memoryWarningThreshold: 500 * 1024 * 1024, // 500MB
  memoryCriticalThreshold: 1024 * 1024 * 1024, // 1GB
  zombieCheckInterval: 60000, // 1 minute
  processNamePattern: "soffice",
};

// =============================================================================
// Resource Manager Class
// =============================================================================

/**
 * Manages resources for document conversion operations
 * Requirements: 7.2, 7.3, 7.6
 */
export class ResourceManager {
  private readonly config: ResourceManagerConfig;
  private stats: ResourceStats = {
    currentMemory: {
      used: 0,
      total: 0,
      percentage: 0,
      timestamp: new Date(),
    },
    peakMemory: 0,
    timeoutCount: 0,
    zombiesCleanedUp: 0,
    activeProcesses: 0,
  };
  private zombieCheckTimer?: NodeJS.Timeout;

  constructor(config: Partial<ResourceManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute an operation with timeout protection
   * Requirements: 7.2 - Implement conversion timeouts to prevent hanging processes
   */
  async withTimeout<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs ?? this.config.operationTimeout;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stats.timeoutCount++;
        const error = new Error(`Operation timed out after ${timeout}ms`);
        error.name = "TimeoutError";
        reject(error);
      }, timeout);

      operation()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Monitor memory usage during an operation
   * Requirements: 7.3 - Monitor memory usage during conversion operations
   */
  async monitorMemory(): Promise<MemoryUsage> {
    try {
      const memInfo = process.memoryUsage();
      const usage: MemoryUsage = {
        used: memInfo.heapUsed,
        total: memInfo.heapTotal,
        percentage: (memInfo.heapUsed / memInfo.heapTotal) * 100,
        timestamp: new Date(),
      };

      // Update stats
      this.stats.currentMemory = usage;
      if (usage.used > this.stats.peakMemory) {
        this.stats.peakMemory = usage.used;
      }

      // Check thresholds and log warnings
      if (usage.used >= this.config.memoryCriticalThreshold) {
        console.error(
          `[ResourceManager] CRITICAL: Memory usage at ${this.formatBytes(usage.used)} (${usage.percentage.toFixed(1)}%)`,
        );
      } else if (usage.used >= this.config.memoryWarningThreshold) {
        console.warn(
          `[ResourceManager] WARNING: Memory usage at ${this.formatBytes(usage.used)} (${usage.percentage.toFixed(1)}%)`,
        );
      }

      return usage;
    } catch (error) {
      console.error("[ResourceManager] Failed to monitor memory:", error);
      return {
        used: 0,
        total: 0,
        percentage: 0,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute an operation with memory monitoring
   * Requirements: 7.3 - Monitor memory usage during conversion operations
   */
  async withMemoryMonitoring<T>(operation: () => Promise<T>): Promise<T> {
    const startMemory = await this.monitorMemory();

    try {
      const result = await operation();
      const endMemory = await this.monitorMemory();

      const memoryDelta = endMemory.used - startMemory.used;
      if (memoryDelta > 0) {
        console.log(`[ResourceManager] Operation used ${this.formatBytes(memoryDelta)} of memory`);
      }

      return result;
    } catch (error) {
      await this.monitorMemory();
      throw error;
    }
  }

  /**
   * Find zombie LibreOffice processes
   * Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
   */
  async findZombieProcesses(): Promise<ProcessInfo[]> {
    try {
      // Use ps command to find processes matching the pattern
      // This works on Unix-like systems (Linux, macOS)
      const { stdout } = await execAsync(
        `ps aux | grep "${this.config.processNamePattern}" | grep -v grep`,
      );

      if (!stdout.trim()) {
        return [];
      }

      const lines = stdout.trim().split("\n");
      const processes: ProcessInfo[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
          const pid = parseInt(parts[1], 10);
          const cpu = parseFloat(parts[2]);
          const memory = parseInt(parts[5], 10) * 1024; // RSS in KB, convert to bytes
          const state = parts[7];
          const command = parts.slice(10).join(" ");

          // Check if process is a zombie (state contains 'Z')
          if (state.includes("Z") || state.includes("<defunct>")) {
            processes.push({
              pid,
              name: command,
              cpu,
              memory,
              state,
            });
          }
        }
      }

      return processes;
    } catch (error) {
      // If grep finds nothing, it returns exit code 1, which is not an error for us
      if (error instanceof Error && "code" in error && error.code === 1) {
        return [];
      }
      console.error("[ResourceManager] Failed to find zombie processes:", error);
      return [];
    }
  }

  /**
   * Kill a specific process
   * Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
   */
  async killProcess(pid: number, force: boolean = false): Promise<boolean> {
    try {
      const signal = force ? "SIGKILL" : "SIGTERM";
      await execAsync(`kill -${signal} ${pid}`);
      console.log(`[ResourceManager] Killed process ${pid} with ${signal}`);
      return true;
    } catch (error) {
      console.error(`[ResourceManager] Failed to kill process ${pid}:`, error);
      return false;
    }
  }

  /**
   * Clean up zombie processes
   * Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
   */
  async cleanupZombieProcesses(): Promise<number> {
    const zombies = await this.findZombieProcesses();

    if (zombies.length === 0) {
      return 0;
    }

    console.log(`[ResourceManager] Found ${zombies.length} zombie process(es), cleaning up...`);

    let cleanedUp = 0;
    for (const zombie of zombies) {
      // Try graceful termination first
      const killed = await this.killProcess(zombie.pid, false);
      if (killed) {
        cleanedUp++;
        this.stats.zombiesCleanedUp++;
      } else {
        // If graceful termination fails, force kill
        const forceKilled = await this.killProcess(zombie.pid, true);
        if (forceKilled) {
          cleanedUp++;
          this.stats.zombiesCleanedUp++;
        }
      }
    }

    console.log(`[ResourceManager] Cleaned up ${cleanedUp} zombie process(es)`);
    return cleanedUp;
  }

  /**
   * Start automatic zombie process cleanup
   * Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
   */
  startZombieCleanup(): void {
    if (this.zombieCheckTimer) {
      return; // Already running
    }

    console.log(
      `[ResourceManager] Starting automatic zombie cleanup (interval: ${this.config.zombieCheckInterval}ms)`,
    );

    this.zombieCheckTimer = setInterval(async () => {
      await this.cleanupZombieProcesses();
    }, this.config.zombieCheckInterval);

    // Don't prevent Node.js from exiting
    this.zombieCheckTimer.unref();
  }

  /**
   * Stop automatic zombie process cleanup
   */
  stopZombieCleanup(): void {
    if (this.zombieCheckTimer) {
      clearInterval(this.zombieCheckTimer);
      this.zombieCheckTimer = undefined;
      console.log("[ResourceManager] Stopped automatic zombie cleanup");
    }
  }

  /**
   * Get current resource statistics
   */
  getStats(): ResourceStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      currentMemory: {
        used: 0,
        total: 0,
        percentage: 0,
        timestamp: new Date(),
      },
      peakMemory: 0,
      timeoutCount: 0,
      zombiesCleanedUp: 0,
      activeProcesses: 0,
    };
  }

  /**
   * Cleanup and shutdown the resource manager
   */
  async shutdown(): Promise<void> {
    this.stopZombieCleanup();
    await this.cleanupZombieProcesses();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let resourceManagerInstance: ResourceManager | null = null;

/**
 * Get the singleton resource manager instance
 */
export function getResourceManager(config?: Partial<ResourceManagerConfig>): ResourceManager {
  if (!resourceManagerInstance) {
    resourceManagerInstance = new ResourceManager(config);
  }
  return resourceManagerInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetResourceManager(): void {
  if (resourceManagerInstance) {
    resourceManagerInstance.stopZombieCleanup();
  }
  resourceManagerInstance = null;
}
