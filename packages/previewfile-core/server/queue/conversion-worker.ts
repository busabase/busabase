/**
 * Conversion Worker - BullMQ Worker for processing document conversions
 *
 * Processes queued document conversion jobs by:
 * 1. Downloading the source file from the URL
 * 2. Converting the document using LibreOffice via DocumentConverter
 * 3. Uploading the converted PDF to S3 storage
 * 4. Returning the result with the output URL
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { type Job, Worker } from "bullmq";
import { getDocumentConverter } from "../converter/document-converter";
import {
  CONVERSION_QUEUE_NAME,
  type ConversionJobData,
  type ConversionJobResult,
  getRedisConnection,
} from "./conversion-queue";

// Worker singleton
// One worker per queue name (see CONVERSION_QUEUE_NAME)
const conversionWorkers = new Map<string, Worker<ConversionJobData, ConversionJobResult>>();

/** Paths and queries can both contain private source read capabilities. */
function describeSourceUrl(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    return url.origin;
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * Process a document conversion job
 * Requirements: 3.2 - Download source file, convert using LibreOffice, upload result to S3
 */
async function processConversionJob(
  job: Job<ConversionJobData, ConversionJobResult>,
): Promise<ConversionJobResult> {
  const { fileUrl, fileName, mimeType, outputFormat, sourceFetch } = job.data;
  const startTime = Date.now();

  console.log(`[ConversionWorker] Processing job ${job.id} for file: ${fileName}`);
  console.log(`[ConversionWorker] Processing job ${job.id} from: ${describeSourceUrl(fileUrl)}`);

  try {
    // Update progress: starting
    await job.updateProgress(10);

    // Get the document converter instance
    // Requirements: 3.5 - Respect existing circuit breaker and resource management patterns
    const documentConverter = getDocumentConverter();

    // Update progress: converter ready
    await job.updateProgress(20);

    // Perform the conversion using the existing DocumentConverter service
    // The DocumentConverter handles:
    // - Downloading the file from fileUrl
    // - Converting using LibreOffice
    // - Uploading to S3
    // - Circuit breaker and resource management
    // Requirements: 3.2 - Download → convert → upload → return result
    const result = await documentConverter.convert({
      fileUrl,
      fileName,
      mimeType,
      outputFormat,
      sourceFetch,
    });

    // Update progress: conversion complete
    await job.updateProgress(90);

    const processingTime = Date.now() - startTime;

    if (result.success) {
      // Requirements: 3.3 - Update job result with output PDF URL on success
      console.log(`[ConversionWorker] Job ${job.id} completed successfully in ${processingTime}ms`);
      await job.updateProgress(100);

      return {
        success: true,
        outputUrl: result.outputUrl,
        outputUri: result.outputUri,
        processingTime,
      };
    } else {
      // Requirements: 3.4 - Update job with error message on failure
      console.error(`[ConversionWorker] Job ${job.id} conversion failed: ${result.error}`);

      return {
        success: false,
        error: result.error || "Conversion failed",
        processingTime,
      };
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    let errorMessage = "Unknown error during conversion";
    let errorType = "unknown";

    if (error instanceof Error) {
      errorMessage = error.message;

      // Classify error type for better error messages
      // Requirements: 3.4 - Handle errors and update job state appropriately
      if (error.name === "CircuitBreakerOpenError") {
        errorType = "circuit_breaker";
        errorMessage = "Conversion service temporarily unavailable due to repeated failures";
      } else if (error.message.includes("timeout") || error.message.includes("Timeout")) {
        errorType = "timeout";
        errorMessage = "Conversion timed out";
      } else if (error.message.includes("download") || error.message.includes("fetch")) {
        errorType = "download";
        errorMessage = `Failed to download source file: ${error.message}`;
      } else if (error.message.includes("LibreOffice")) {
        errorType = "conversion";
        errorMessage = `LibreOffice conversion error: ${error.message}`;
      } else if (error.message.includes("S3") || error.message.includes("upload")) {
        errorType = "upload";
        errorMessage = `Failed to upload converted file: ${error.message}`;
      } else if (error.message.includes("Unsupported")) {
        errorType = "validation";
        // Keep original message for validation errors
      }
    }

    console.error(`[ConversionWorker] Job ${job.id} failed (${errorType}):`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      processingTime,
    };
  }
}

/**
 * Start the conversion worker
 * Requirements: 3.1 - Process jobs from the Conversion_Queue
 */
export function startConversionWorker(
  options: { queueName?: string } = {},
): Worker<ConversionJobData, ConversionJobResult> | null {
  const queueName = options.queueName ?? CONVERSION_QUEUE_NAME;
  const existing = conversionWorkers.get(queueName);
  if (existing) {
    console.log(`[ConversionWorker] Worker for ${queueName} already running`);
    return existing;
  }

  const connection = getRedisConnection();
  if (!connection) {
    console.warn("[ConversionWorker] Redis not available, worker disabled");
    return null;
  }

  // Create the worker with concurrency and rate limiting
  // Requirements: 3.5 - Respect existing resource management patterns
  const conversionWorker = new Worker<ConversionJobData, ConversionJobResult>(
    queueName,
    processConversionJob,
    {
      connection: connection as any,
      concurrency: 3, // Process up to 3 conversions concurrently (matches DocumentConverter default)
      limiter: {
        max: 5, // Max 5 jobs
        duration: 1000, // per second
      },
    },
  );

  // Set up event handlers for logging and monitoring
  conversionWorker.on("completed", (job, result) => {
    console.log(
      `[ConversionWorker] Job ${job.id} completed:`,
      result.success ? "success" : "failed",
    );
  });

  conversionWorker.on("failed", (job, err) => {
    console.error(`[ConversionWorker] Job ${job?.id} failed:`, err.message);
  });

  conversionWorker.on("error", (err) => {
    console.error("[ConversionWorker] Worker error:", err.message);
  });

  conversionWorker.on("stalled", (jobId) => {
    console.warn(`[ConversionWorker] Job ${jobId} stalled`);
  });

  console.log(`[ConversionWorker] Worker started on queue ${queueName}`);

  conversionWorkers.set(queueName, conversionWorker);
  return conversionWorker;
}

/**
 * Stop the conversion worker
 */
export async function stopConversionWorker(): Promise<void> {
  for (const [queueName, conversionWorker] of conversionWorkers) {
    await conversionWorker.close();
    console.log(`[ConversionWorker] Worker for ${queueName} stopped`);
  }
  conversionWorkers.clear();
}

/**
 * Get the conversion worker instance
 */
export function getConversionWorker(
  queueName: string = CONVERSION_QUEUE_NAME,
): Worker<ConversionJobData, ConversionJobResult> | null {
  return conversionWorkers.get(queueName) ?? null;
}
