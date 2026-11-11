/**
 * Type definitions for the centralized file fetch layer.
 *
 * This module provides types for managing file fetching, caching, and format conversion
 * across viewer components. It eliminates duplicate network requests and handles one-time
 * access URLs (like pre-signed S3 URLs) through aggressive caching.
 */

/**
 * Supported data formats for file fetching.
 * - 'arrayBuffer': Raw binary data (most flexible, can convert to other formats)
 * - 'blob': Binary large object (useful for creating object URLs)
 * - 'text': UTF-8 decoded text string
 */
export type DataFormat = "arrayBuffer" | "blob" | "text";

/**
 * Type mapping for data format to TypeScript type.
 * Used for type-safe hook return values.
 */
export type DataFormatMap = {
  arrayBuffer: ArrayBuffer;
  blob: Blob;
  text: string;
};

/**
 * State returned by the useFileFetch hook.
 * Provides loading state, fetched data, and error information.
 *
 * @template T - The type of data being fetched (ArrayBuffer, Blob, or string)
 */
export interface FetchState<T> {
  /** The fetched file data, or null if not yet loaded or if an error occurred */
  data: T | null;

  /** True while a fetch operation is in progress */
  loading: boolean;

  /** Error object if the fetch failed, null otherwise */
  error: Error | null;
}

/**
 * Complete result returned by the useFileFetch hook.
 * Extends FetchState with a refetch function for manual cache invalidation.
 *
 * @template T - The type of data being fetched (ArrayBuffer, Blob, or string)
 */
export interface UseFileFetchResult<T> extends FetchState<T> {
  /** Function to manually clear cache and re-fetch the file */
  refetch: () => Promise<void>;
}

/**
 * Internal cache entry structure (used by FileFetchService).
 * Stores fetched file data with metadata for future enhancements (e.g., TTL).
 */
export interface CacheEntry {
  /** The URL used as the cache key */
  url: string;

  /** The cached file data stored as ArrayBuffer */
  data: ArrayBuffer;

  /** Timestamp when the data was cached (milliseconds since epoch) */
  timestamp: number;
}

/**
 * Error thrown when a file fetch operation fails.
 * Includes the URL and optional HTTP status code for debugging.
 */
export class FileFetchError extends Error {
  /** The URL that failed to fetch */
  public readonly url: string;

  /** HTTP status code if the error was due to a non-OK response */
  public readonly statusCode?: number;

  constructor(message: string, url: string, statusCode?: number) {
    super(message);
    this.name = "FileFetchError";
    this.url = url;
    this.statusCode = statusCode;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileFetchError);
    }
  }
}

/**
 * Error thrown when format conversion fails.
 * Includes the URL and target format for debugging.
 */
export class FormatConversionError extends Error {
  /** The URL of the file that failed to convert */
  public readonly url: string;

  /** The target format that was being converted to */
  public readonly targetFormat: DataFormat;

  constructor(message: string, url: string, targetFormat: DataFormat) {
    super(message);
    this.name = "FormatConversionError";
    this.url = url;
    this.targetFormat = targetFormat;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FormatConversionError);
    }
  }
}
