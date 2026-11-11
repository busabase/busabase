/**
 * FileFetchService - Centralized file fetching and caching service.
 *
 * This singleton service manages file fetching across the application, providing:
 * - Single fetch per URL (deduplicates concurrent requests)
 * - In-memory caching (handles one-time access URLs)
 * - Multiple format support (ArrayBuffer, Blob, text)
 * - Consistent error handling
 *
 * @example
 * ```typescript
 * const service = FileFetchService.getInstance();
 * const data = await service.fetchAsArrayBuffer('https://example.com/file.pdf');
 * ```
 */

import { FileFetchError, FormatConversionError } from "./types";

export class FileFetchService {
  /** Singleton instance */
  private static instance: FileFetchService | null = null;

  /** Cache storage: URL -> ArrayBuffer */
  private cache: Map<string, ArrayBuffer>;

  /** Track in-flight requests to deduplicate concurrent fetches: URL -> Promise */
  private pendingRequests: Map<string, Promise<ArrayBuffer>>;

  /**
   * Private constructor to enforce singleton pattern.
   * Use getInstance() to access the service.
   */
  private constructor() {
    this.cache = new Map<string, ArrayBuffer>();
    this.pendingRequests = new Map<string, Promise<ArrayBuffer>>();
  }

  /**
   * Get the singleton instance of FileFetchService.
   * Creates the instance on first call.
   *
   * @returns The singleton FileFetchService instance
   */
  public static getInstance(): FileFetchService {
    if (!FileFetchService.instance) {
      FileFetchService.instance = new FileFetchService();
    }
    return FileFetchService.instance;
  }

  /**
   * Check if a URL is cached.
   *
   * @param url - The URL to check
   * @returns True if the URL is in the cache, false otherwise
   */
  public isCached(url: string): boolean {
    return this.cache.has(url);
  }

  /**
   * Clear all cached entries.
   * Useful for memory management or testing.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear a specific URL from the cache.
   *
   * @param url - The URL to remove from cache
   */
  public clearUrl(url: string): void {
    this.cache.delete(url);
  }

  /**
   * Fetch a file as ArrayBuffer with caching and deduplication.
   *
   * This is the primary fetch method. It:
   * 1. Returns cached data if available
   * 2. Waits for in-flight requests to avoid duplicate fetches
   * 3. Fetches from network if not cached
   * 4. Stores result in cache for future requests
   *
   * @param url - The URL of the file to fetch
   * @returns Promise resolving to the file data as ArrayBuffer
   * @throws {FileFetchError} If the fetch fails or returns non-OK status
   */
  public async fetchAsArrayBuffer(url: string): Promise<ArrayBuffer> {
    // Check cache first
    if (this.cache.has(url)) {
      return this.cache.get(url) as ArrayBuffer;
    }

    // Check if fetch is already in progress
    if (this.pendingRequests.has(url)) {
      return this.pendingRequests.get(url) as Promise<ArrayBuffer>;
    }

    // Start new fetch operation
    const fetchPromise = this.performFetch(url);

    // Store promise to deduplicate concurrent requests
    this.pendingRequests.set(url, fetchPromise);

    try {
      const arrayBuffer = await fetchPromise;

      // Store in cache
      this.cache.set(url, arrayBuffer);

      return arrayBuffer;
    } finally {
      // Always clean up pending request
      this.pendingRequests.delete(url);
    }
  }

  /**
   * Internal method to perform the actual fetch operation.
   * Handles network errors and non-OK responses.
   *
   * @param url - The URL to fetch
   * @returns Promise resolving to ArrayBuffer
   * @throws {FileFetchError} If fetch fails or returns non-OK status
   */
  private async performFetch(url: string): Promise<ArrayBuffer> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new FileFetchError(
          `Failed to fetch file: ${response.status} ${response.statusText}`,
          url,
          response.status,
        );
      }

      return await response.arrayBuffer();
    } catch (error) {
      // If it's already a FileFetchError, re-throw it
      if (error instanceof FileFetchError) {
        throw error;
      }

      // Wrap other errors (network errors, etc.) in FileFetchError
      throw new FileFetchError(
        `Network error while fetching file: ${error instanceof Error ? error.message : String(error)}`,
        url,
      );
    }
  }
  /**
   * Fetch a file as Blob with caching and deduplication.
   *
   * This method uses the cached ArrayBuffer data (or fetches if not cached)
   * and converts it to a Blob. No additional network request is made if the
   * file is already cached.
   *
   * @param url - The URL of the file to fetch
   * @returns Promise resolving to the file data as Blob
   * @throws {FileFetchError} If the fetch fails or returns non-OK status
   */
  public async fetchAsBlob(url: string): Promise<Blob> {
    // Get cached or fetch as ArrayBuffer
    const arrayBuffer = await this.fetchAsArrayBuffer(url);

    // Convert ArrayBuffer to Blob
    return new Blob([arrayBuffer]);
  }
  /**
   * Fetch a file as text with caching and deduplication.
   *
   * This method uses the cached ArrayBuffer data (or fetches if not cached)
   * and converts it to a UTF-8 text string using TextDecoder. No additional
   * network request is made if the file is already cached.
   *
   * @param url - The URL of the file to fetch
   * @returns Promise resolving to the file data as a UTF-8 string
   * @throws {FileFetchError} If the fetch fails or returns non-OK status
   * @throws {FormatConversionError} If the ArrayBuffer cannot be decoded as UTF-8 text
   */
  public async fetchAsText(url: string): Promise<string> {
    // Get cached or fetch as ArrayBuffer
    const arrayBuffer = await this.fetchAsArrayBuffer(url);

    // Convert ArrayBuffer to text using TextDecoder
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      return decoder.decode(arrayBuffer);
    } catch (error) {
      // Wrap decoding errors in FormatConversionError
      throw new FormatConversionError(
        `Failed to decode file as UTF-8 text: ${error instanceof Error ? error.message : String(error)}`,
        url,
        "text",
      );
    }
  }
}
