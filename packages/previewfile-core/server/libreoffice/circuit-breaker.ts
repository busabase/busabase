/**
 * Circuit Breaker Pattern Implementation
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when the LibreOffice service becomes unavailable.
 *
 * Requirements: 6.5, 6.6
 */

// =============================================================================
// Types
// =============================================================================

/** Circuit breaker state */
export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Configuration for the circuit breaker */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before attempting reset */
  resetTimeout: number;
  /** Time window in milliseconds for counting failures */
  failureWindow: number;
  /** Name of the circuit breaker for logging */
  name?: string;
}

/** Circuit breaker statistics */
export interface CircuitBreakerStats {
  /** Current state of the circuit breaker */
  state: CircuitBreakerState;
  /** Total number of failures */
  totalFailures: number;
  /** Total number of successes */
  totalSuccesses: number;
  /** Number of failures in current window */
  recentFailures: number;
  /** Timestamp of last failure */
  lastFailureTime?: Date;
  /** Timestamp of last state change */
  lastStateChange: Date;
  /** Number of times circuit has opened */
  timesOpened: number;
}

/** Failure record for tracking failures in time window */
interface FailureRecord {
  timestamp: Date;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  failureWindow: 10000, // 10 seconds
  name: "CircuitBreaker",
};

// =============================================================================
// Circuit Breaker Class
// =============================================================================

/**
 * Circuit Breaker implementation for protecting against cascading failures
 * Requirements: 6.6 - Implement circuit breaker pattern for LibreOffice service failures
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = "CLOSED";
  private failures: FailureRecord[] = [];
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureTime?: Date;
  private lastStateChange: Date = new Date();
  private timesOpened = 0;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute an operation with circuit breaker protection
   * Requirements: 6.6 - Circuit breaker should activate to prevent further requests until service recovers
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === "OPEN") {
      if (this.shouldAttemptReset()) {
        this.transitionTo("HALF_OPEN");
        this.log("Attempting reset - transitioning to HALF_OPEN");
      } else {
        const error = new Error("Circuit breaker is OPEN - service unavailable");
        error.name = "CircuitBreakerOpenError";
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      recentFailures: this.getRecentFailureCount(),
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
      timesOpened: this.timesOpened,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Manually reset the circuit breaker (for testing or admin intervention)
   */
  reset(): void {
    this.transitionTo("CLOSED");
    this.failures = [];
    this.log("Circuit breaker manually reset");
  }

  /**
   * Manually open the circuit breaker (for maintenance or testing)
   */
  open(): void {
    this.transitionTo("OPEN");
    this.log("Circuit breaker manually opened");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.totalSuccesses++;

    if (this.state === "HALF_OPEN") {
      // Success in HALF_OPEN state means service has recovered
      this.transitionTo("CLOSED");
      this.failures = [];
      this.log("Service recovered - transitioning to CLOSED");
    }
  }

  /**
   * Handle failed operation
   * Requirements: 6.5 - Log conversion errors for debugging and monitoring
   */
  private onFailure(error: unknown): void {
    this.totalFailures++;
    this.lastFailureTime = new Date();
    this.failures.push({ timestamp: this.lastFailureTime });

    // Log the error
    // Requirements: 6.5 - The system shall log conversion errors
    this.logError(error);

    // Clean up old failures outside the window
    this.cleanupOldFailures();

    const recentFailures = this.getRecentFailureCount();

    if (this.state === "HALF_OPEN") {
      // Any failure in HALF_OPEN state reopens the circuit
      this.transitionTo("OPEN");
      this.log(
        `Failure in HALF_OPEN state - reopening circuit (recent failures: ${recentFailures})`,
      );
    } else if (this.state === "CLOSED" && recentFailures >= this.config.failureThreshold) {
      // Too many failures in CLOSED state opens the circuit
      this.transitionTo("OPEN");
      this.timesOpened++;
      this.log(
        `Failure threshold exceeded (${recentFailures}/${this.config.failureThreshold}) - opening circuit`,
      );
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceLastFailure >= this.config.resetTimeout;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    if (oldState !== newState) {
      this.log(`State transition: ${oldState} -> ${newState}`);
    }
  }

  /**
   * Get count of failures within the failure window
   */
  private getRecentFailureCount(): number {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;

    return this.failures.filter((f) => f.timestamp.getTime() >= windowStart).length;
  }

  /**
   * Remove failures that are outside the failure window
   */
  private cleanupOldFailures(): void {
    const now = Date.now();
    const windowStart = now - this.config.failureWindow;

    this.failures = this.failures.filter((f) => f.timestamp.getTime() >= windowStart);
  }

  /**
   * Log a message with circuit breaker name
   */
  private log(message: string): void {
    console.log(`[${this.config.name}] ${message}`);
  }

  /**
   * Log an error with details
   * Requirements: 6.5 - Log conversion errors for debugging and monitoring
   */
  private logError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "Error";

    console.error(`[${this.config.name}] Operation failed: ${errorName} - ${errorMessage}`, {
      state: this.state,
      recentFailures: this.getRecentFailureCount(),
      totalFailures: this.totalFailures,
      timestamp: new Date().toISOString(),
    });
  }
}

// =============================================================================
// Singleton Instance for LibreOffice Service
// =============================================================================

let libreOfficeCircuitBreaker: CircuitBreaker | null = null;

/**
 * Get the singleton circuit breaker instance for LibreOffice service
 */
export function getLibreOfficeCircuitBreaker(
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  if (!libreOfficeCircuitBreaker) {
    libreOfficeCircuitBreaker = new CircuitBreaker({
      ...config,
      name: config?.name || "LibreOfficeService",
    });
  }
  return libreOfficeCircuitBreaker;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetLibreOfficeCircuitBreaker(): void {
  libreOfficeCircuitBreaker = null;
}
