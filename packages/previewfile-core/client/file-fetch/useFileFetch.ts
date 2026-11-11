/**
 * useFileFetch - React hook for fetching files with caching and state management.
 *
 * This hook provides a React-friendly interface to the FileFetchService, managing
 * loading states, errors, and data fetching automatically. It handles component
 * lifecycle, URL changes, and provides a refetch function for manual cache invalidation.
 *
 * @example
 * ```typescript
 * // Fetch as ArrayBuffer (default)
 * const { data, loading, error, refetch } = useFileFetch(fileUrl);
 *
 * // Fetch as Blob
 * const { data, loading, error } = useFileFetch(fileUrl, 'blob');
 *
 * // Fetch as text
 * const { data, loading, error } = useFileFetch(fileUrl, 'text');
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import { FileFetchService } from "./FileFetchService";
import type { DataFormat, DataFormatMap, UseFileFetchResult } from "./types";

/**
 * React hook for fetching files with automatic caching and state management.
 *
 * Features:
 * - Automatic fetch on mount and URL/format changes
 * - Loading, error, and data state management
 * - Deduplicates concurrent requests for the same URL
 * - Returns cached data instantly on subsequent requests
 * - Supports multiple data formats (ArrayBuffer, Blob, text)
 * - Provides refetch function for manual cache invalidation
 *
 * @template F - The data format type ('arrayBuffer' | 'blob' | 'text')
 * @param url - The URL of the file to fetch (undefined to skip fetching)
 * @param format - The desired data format (default: 'arrayBuffer')
 * @returns Object containing data, loading state, error, and refetch function
 *
 * @example
 * ```typescript
 * function MyComponent({ fileUrl }: { fileUrl: string }) {
 *   const { data, loading, error, refetch } = useFileFetch(fileUrl, 'arrayBuffer');
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!data) return null;
 *
 *   // Use data...
 *   return <div>File loaded: {data.byteLength} bytes</div>;
 * }
 * ```
 */
export function useFileFetch<F extends DataFormat = "arrayBuffer">(
  url: string | undefined,
  format: F = "arrayBuffer" as F,
): UseFileFetchResult<DataFormatMap[F]> {
  // State management
  const [data, setData] = useState<DataFormatMap[F] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Get singleton service instance
  const service = FileFetchService.getInstance();

  // Refetch function - clears cache and triggers re-fetch
  const refetch = useCallback(async () => {
    if (!url) return;

    // Clear cache for this URL
    service.clearUrl(url);

    // Reset state and trigger re-fetch
    setData(null);
    setError(null);
    setLoading(true);

    try {
      let fetchedData: DataFormatMap[F];

      if (format === "arrayBuffer") {
        fetchedData = (await service.fetchAsArrayBuffer(url)) as DataFormatMap[F];
      } else if (format === "blob") {
        fetchedData = (await service.fetchAsBlob(url)) as DataFormatMap[F];
      } else if (format === "text") {
        fetchedData = (await service.fetchAsText(url)) as DataFormatMap[F];
      } else {
        throw new Error(`Unsupported format: ${format}`);
      }

      setData(fetchedData);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  }, [url, format, service]);

  // Effect to trigger fetch on mount and when url/format changes
  useEffect(() => {
    // Skip if no URL provided
    if (!url) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Start fetch operation
    setLoading(true);
    setError(null);

    // Perform fetch based on format
    let fetchPromise: Promise<DataFormatMap[F]>;

    if (format === "arrayBuffer") {
      fetchPromise = service.fetchAsArrayBuffer(url) as Promise<DataFormatMap[F]>;
    } else if (format === "blob") {
      fetchPromise = service.fetchAsBlob(url) as Promise<DataFormatMap[F]>;
    } else if (format === "text") {
      fetchPromise = service.fetchAsText(url) as Promise<DataFormatMap[F]>;
    } else {
      // Unsupported format
      setError(new Error(`Unsupported format: ${format}`));
      setLoading(false);
      return;
    }

    // Handle fetch result
    fetchPromise
      .then((fetchedData) => {
        setData(fetchedData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [url, format, service]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
