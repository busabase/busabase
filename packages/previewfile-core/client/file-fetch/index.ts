/**
 * Centralized File Fetch Layer
 *
 * This module provides a centralized file fetching and caching solution that eliminates
 * duplicate network requests across viewer components. It handles one-time access URLs
 * (like pre-signed S3 URLs) through aggressive caching and provides multiple data format
 * support (ArrayBuffer, Blob, text).
 *
 * ## Key Features
 *
 * - **Single Fetch Per URL**: Each file URL is fetched only once, even with concurrent requests
 * - **In-Memory Caching**: Fetched files are cached for the application session lifetime
 * - **Multiple Formats**: Retrieve cached data as ArrayBuffer, Blob, or text without re-fetching
 * - **One-Time URL Support**: Handles pre-signed S3 URLs and other expiring URLs correctly
 * - **React Integration**: Provides a hook with automatic state management
 * - **Consistent Error Handling**: Unified error handling across all fetch operations
 *
 * ## Usage
 *
 * ### Using the React Hook (Recommended)
 *
 * ```typescript
 * import { useFileFetch } from '@/lib/file-fetch';
 *
 * function MyViewer({ fileUrl }: { fileUrl: string }) {
 *   // Fetch as ArrayBuffer (default)
 *   const { data, loading, error, refetch } = useFileFetch(fileUrl);
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!data) return null;
 *
 *   // Use the ArrayBuffer data...
 *   return <div>Loaded {data.byteLength} bytes</div>;
 * }
 *
 * // Fetch as Blob
 * const { data: blob } = useFileFetch(fileUrl, 'blob');
 *
 * // Fetch as text
 * const { data: text } = useFileFetch(fileUrl, 'text');
 * ```
 *
 * ### Using the Service Directly
 *
 * ```typescript
 * import { FileFetchService } from '@/lib/file-fetch';
 *
 * const service = FileFetchService.getInstance();
 *
 * // Fetch as ArrayBuffer
 * const arrayBuffer = await service.fetchAsArrayBuffer(url);
 *
 * // Fetch as Blob
 * const blob = await service.fetchAsBlob(url);
 *
 * // Fetch as text
 * const text = await service.fetchAsText(url);
 *
 * // Check cache status
 * if (service.isCached(url)) {
 *   console.log('File is cached');
 * }
 *
 * // Clear cache
 * service.clearCache(); // Clear all
 * service.clearUrl(url); // Clear specific URL
 * ```
 *
 * ## Migration Guide
 *
 * Replace direct `fetch()` calls in viewer components:
 *
 * **Before:**
 * ```typescript
 * const [loading, setLoading] = useState(true);
 * const [error, setError] = useState<Error | null>(null);
 * const [data, setData] = useState<ArrayBuffer | null>(null);
 *
 * useEffect(() => {
 *   const loadFile = async () => {
 *     try {
 *       setLoading(true);
 *       const response = await fetch(fileUrl);
 *       if (!response.ok) throw new Error('Failed to load');
 *       const arrayBuffer = await response.arrayBuffer();
 *       setData(arrayBuffer);
 *       setLoading(false);
 *     } catch (err) {
 *       setError(err);
 *       setLoading(false);
 *     }
 *   };
 *   loadFile();
 * }, [fileUrl]);
 * ```
 *
 * **After:**
 * ```typescript
 * const { data, loading, error } = useFileFetch(fileUrl, 'arrayBuffer');
 * ```
 *
 * @module file-fetch
 */

// Export the main service class
export { FileFetchService } from "./FileFetchService";
// Export types
export type {
  CacheEntry,
  DataFormat,
  DataFormatMap,
  FetchState,
  UseFileFetchResult,
} from "./types";
// Export error classes
export {
  FileFetchError,
  FormatConversionError,
} from "./types";
// Export the React hook
export { useFileFetch } from "./useFileFetch";
