/**
 * Conversion Queue - BullMQ Queue Infrastructure
 *
 * Handles async processing of document conversion jobs.
 * Jobs are queued when users request document conversion, and processed
 * by a background worker that converts documents to PDF/HTML.
 */

import { createHash } from "node:crypto";
import { type JobsOptions, Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { resolveConversionRedisUrl } from "../redis-url";

// Job data structure for document conversion
export interface ConversionJobData {
  jobId: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  outputFormat: "pdf" | "html";
  /** See `ConversionRequest.sourceFetch`. */
  sourceFetch?: "public";
}

// Job result structure
export interface ConversionJobResult {
  success: boolean;
  outputUrl?: string;
  outputUri?: string;
  processingTime?: number;
  error?: string;
}

// Job status structure
export interface JobStatus {
  state: string;
  progress: number;
  data?: Pick<ConversionJobData, "jobId" | "fileName" | "mimeType" | "outputFormat">;
  result?: ConversionJobResult;
  error?: string;
}

// Default queue name. Every queue function also takes an explicit `queueName`:
// hosts sharing one Redis instance (Buda, Busabase Cloud, PreviewFile) must
// each use their own queue, or one host's worker takes the other's jobs and
// writes the result to storage the requesting host cannot serve.
export const CONVERSION_QUEUE_NAME =
  process.env.PREVIEWFILE_CONVERSION_QUEUE || "document-conversion";

// Redis connection singleton
let redisConnection: IORedis | null = null;

/**
 * Get or create Redis connection for BullMQ
 * Reuses existing Redis config from environment
 */
export function getRedisConnection(): IORedis | null {
  if (redisConnection) {
    return redisConnection;
  }

  const redisUrl = resolveConversionRedisUrl();
  if (!redisUrl) {
    console.warn("[ConversionQueue] No redis:// REDIS_URL configured, queue disabled");
    return null;
  }

  try {
    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });

    redisConnection.on("error", (err) => {
      console.error("[ConversionQueue] Redis connection error:", err.message);
    });

    redisConnection.on("connect", () => {
      console.log("[ConversionQueue] Redis connected");
    });

    return redisConnection;
  } catch (error) {
    console.error("[ConversionQueue] Failed to create Redis connection:", error);
    return null;
  }
}

// One queue per name
const conversionQueues = new Map<string, Queue<ConversionJobData, ConversionJobResult>>();

/**
 * Get or create the conversion queue singleton
 * Configured with:
 * - 3 retry attempts with exponential backoff
 * - Completed jobs removed after 1 hour
 * - Failed jobs removed after 24 hours
 */
export function getConversionQueue(
  queueName: string = CONVERSION_QUEUE_NAME,
): Queue<ConversionJobData, ConversionJobResult> | null {
  const existing = conversionQueues.get(queueName);
  if (existing) {
    return existing;
  }

  const connection = getRedisConnection();
  if (!connection) {
    return null;
  }

  const conversionQueue = new Queue<ConversionJobData, ConversionJobResult>(queueName, {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000, // Initial delay 1s
      },
      removeOnComplete: {
        age: 3600, // Remove completed jobs after 1 hour
        count: 1000, // Keep at most 1000 completed jobs
      },
      removeOnFail: {
        age: 86400, // Remove failed jobs after 24 hours
      },
    },
  });

  conversionQueues.set(queueName, conversionQueue);
  return conversionQueue;
}

/**
 * Generate a unique job ID based on file URL and output format
 * This helps prevent duplicate processing of the same conversion request
 */
export function generateConversionJobId(fileUrl: string, outputFormat: string): string {
  const hash = createHash("sha256")
    .update(`${fileUrl}-${outputFormat}`)
    .digest("hex")
    .substring(0, 16);
  return `conversion-${hash}`;
}

/**
 * Add a conversion job to the queue
 * @param data - The conversion job data
 * @param options - Optional BullMQ job options
 * @param queueName - Queue to add the job to (see CONVERSION_QUEUE_NAME)
 * @returns The job ID if successfully enqueued, null otherwise
 */
export async function enqueueConversion(
  data: ConversionJobData,
  options?: JobsOptions,
  queueName: string = CONVERSION_QUEUE_NAME,
): Promise<string | null> {
  const queue = getConversionQueue(queueName);
  if (!queue) {
    console.error("[ConversionQueue] Queue not available, cannot enqueue job");
    return null;
  }

  // Use the provided jobId or generate one
  const jobId = data.jobId || generateConversionJobId(data.fileUrl, data.outputFormat);

  try {
    // Check if job already exists
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "active" || state === "waiting" || state === "delayed") {
        console.log(`[ConversionQueue] Job ${jobId} already exists in state: ${state}`);
        return jobId;
      }
      // If job exists but is completed/failed, remove it to allow re-processing
      if (state === "completed" || state === "failed") {
        await existingJob.remove();
        console.log(`[ConversionQueue] Removed existing ${state} job ${jobId} for re-processing`);
      }
    }

    const job = await queue.add("convert", data, {
      jobId,
      ...options,
    });

    console.log(`[ConversionQueue] Enqueued job ${job.id} for file: ${data.fileName}`);
    return job.id ?? null;
  } catch (error) {
    console.error("[ConversionQueue] Failed to enqueue job:", error);
    return null;
  }
}

/**
 * Get the status of a conversion job by ID
 * @param jobId - The job ID to check
 * @param queueName - Queue the job was added to
 * @returns Job status including state, progress, data, and result/error
 */
export async function getConversionJobStatus(
  jobId: string,
  queueName: string = CONVERSION_QUEUE_NAME,
): Promise<JobStatus | null> {
  const queue = getConversionQueue(queueName);
  if (!queue) {
    return null;
  }

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = (job.progress as number) || 0;
    // Source URLs can be temporary read capabilities. Status callers need only
    // display metadata, never the worker's private fetch location.
    const data = {
      jobId: job.data.jobId,
      fileName: job.data.fileName,
      mimeType: job.data.mimeType,
      outputFormat: job.data.outputFormat,
    };

    if (state === "completed") {
      return {
        state,
        progress: 100,
        data,
        result: job.returnvalue,
      };
    }

    if (state === "failed") {
      return {
        state,
        progress,
        data,
        error: job.failedReason,
      };
    }

    return {
      state,
      progress,
      data,
    };
  } catch (error) {
    console.error("[ConversionQueue] Failed to get job status:", error);
    return null;
  }
}

// One QueueEvents listener per queue name
const conversionQueueEvents = new Map<string, QueueEvents>();

/**
 * Get or create QueueEvents for listening to job lifecycle events
 * QueueEvents requires its own Redis connection separate from the Queue
 */
export function getQueueEvents(queueName: string = CONVERSION_QUEUE_NAME): QueueEvents | null {
  const existing = conversionQueueEvents.get(queueName);
  if (existing) {
    return existing;
  }

  const redisUrl = resolveConversionRedisUrl();
  if (!redisUrl) {
    console.warn("[ConversionQueue] No redis:// REDIS_URL configured, QueueEvents disabled");
    return null;
  }

  try {
    // QueueEvents needs its own Redis connection
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const queueEvents = new QueueEvents(queueName, {
      connection: connection as any,
    });

    queueEvents.on("error", (err) => {
      console.error("[ConversionQueue] QueueEvents error:", err.message);
    });

    conversionQueueEvents.set(queueName, queueEvents);
    return queueEvents;
  } catch (error) {
    console.error("[ConversionQueue] Failed to create QueueEvents:", error);
    return null;
  }
}

/**
 * Fallback: Poll for job completion with exponential backoff
 * Used when QueueEvents is unavailable
 */
async function waitForConversionCompletionPolling(
  jobId: string,
  timeout: number,
  queueName: string,
): Promise<ConversionJobResult | null> {
  const startTime = Date.now();
  let delay = 100; // Start with 100ms
  const maxDelay = 2000; // Cap at 2s

  while (Date.now() - startTime < timeout) {
    const status = await getConversionJobStatus(jobId, queueName);

    if (status?.state === "completed") {
      if (status.result?.outputUrl) {
        return status.result;
      }
      // Result missing outputUrl - shouldn't happen but handle gracefully
      console.error(
        `[ConversionQueue] Polling: Job ${jobId} completed but result missing outputUrl`,
      );
      return { success: false, error: "Conversion completed but result is missing" };
    }
    if (status?.state === "failed") {
      return { success: false, error: status.error };
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, maxDelay);
  }

  return null; // Timeout
}

/**
 * Wait for a conversion job to complete with timeout
 * Uses BullMQ QueueEvents for event-driven waiting, with fallback to polling
 *
 * @param jobId - The job ID to wait for
 * @param timeout - Maximum time to wait in ms (default: 60000 = 60 seconds)
 * @param queueName - Queue the job was added to
 * @returns Job result or null if timeout
 */
export async function waitForConversionCompletion(
  jobId: string,
  timeout: number = 60000,
  queueName: string = CONVERSION_QUEUE_NAME,
): Promise<ConversionJobResult | null> {
  const events = getQueueEvents(queueName);
  if (!events) {
    // Fallback to polling if QueueEvents unavailable
    console.log(
      `[ConversionQueue] QueueEvents unavailable, falling back to polling for job ${jobId}`,
    );
    return waitForConversionCompletionPolling(jobId, timeout, queueName);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        events.off("completed", onCompleted);
        events.off("failed", onFailed);
      }
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      console.log(`[ConversionQueue] Job ${jobId} timed out after ${timeout}ms`);
      resolve(null); // Timeout
    }, timeout);

    const onCompleted = async ({
      jobId: completedJobId,
      returnvalue,
    }: {
      jobId: string;
      returnvalue: string;
    }) => {
      if (completedJobId === jobId && !resolved) {
        clearTimeout(timeoutId);
        cleanup();
        console.log(`[ConversionQueue] Job ${jobId} completed, returnvalue:`, returnvalue);
        try {
          // returnvalue might be a string (JSON) or already parsed object
          const result = typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue;
          resolve(result as ConversionJobResult);
        } catch (parseError) {
          console.error(
            `[ConversionQueue] Failed to parse returnvalue for job ${jobId}:`,
            parseError,
          );
          // Fallback: fetch the job directly to get the result
          const status = await getConversionJobStatus(jobId, queueName);
          if (status?.result) {
            resolve(status.result);
          } else {
            resolve({ success: false, error: "Failed to parse conversion result" });
          }
        }
      }
    };

    const onFailed = async ({
      jobId: failedJobId,
      failedReason,
    }: {
      jobId: string;
      failedReason: string;
    }) => {
      if (failedJobId === jobId && !resolved) {
        clearTimeout(timeoutId);
        cleanup();
        console.log(`[ConversionQueue] Job ${jobId} failed: ${failedReason}`);
        resolve({ success: false, error: failedReason });
      }
    };

    events.on("completed", onCompleted);
    events.on("failed", onFailed);

    // Check if job already completed before we started listening
    // This handles the race condition where job completes before listener is attached
    getConversionJobStatus(jobId, queueName).then((status) => {
      if (resolved) return;

      if (status?.state === "completed") {
        clearTimeout(timeoutId);
        cleanup();
        console.log(`[ConversionQueue] Job ${jobId} was already completed, result:`, status.result);
        if (status.result?.outputUrl) {
          resolve(status.result);
        } else {
          // Result missing outputUrl - this shouldn't happen but handle gracefully
          console.error(`[ConversionQueue] Job ${jobId} completed but result missing outputUrl`);
          resolve({ success: false, error: "Conversion completed but result is missing" });
        }
      } else if (status?.state === "failed") {
        clearTimeout(timeoutId);
        cleanup();
        console.log(`[ConversionQueue] Job ${jobId} was already failed`);
        resolve({ success: false, error: status.error });
      }
      // If still processing, continue waiting for events
    });
  });
}

/**
 * Close the queue, QueueEvents, and Redis connection
 * Should be called during graceful shutdown
 */
export async function closeConversionQueue(): Promise<void> {
  for (const queueEvents of conversionQueueEvents.values()) {
    await queueEvents.close();
  }
  conversionQueueEvents.clear();

  for (const conversionQueue of conversionQueues.values()) {
    await conversionQueue.close();
  }
  conversionQueues.clear();

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}
