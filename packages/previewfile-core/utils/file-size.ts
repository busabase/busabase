/**
 * File size formatting utilities for the PreviewFile dashboard
 */

export interface FileSizeFormat {
  value: number;
  unit: "B" | "KB" | "MB" | "GB" | "TB";
  formatted: string; // e.g., "1.25 MB"
}

/**
 * Format file size in bytes to human-readable format
 * Uses 1024-based calculations (binary prefixes)
 *
 * @param bytes - File size in bytes
 * @returns Formatted file size object with value, unit, and formatted string
 *
 * @example
 * formatFileSize(0) // { value: 0, unit: 'B', formatted: '0 B' }
 * formatFileSize(1024) // { value: 1, unit: 'KB', formatted: '1 KB' }
 * formatFileSize(1536) // { value: 1.5, unit: 'KB', formatted: '1.5 KB' }
 * formatFileSize(1048576) // { value: 1, unit: 'MB', formatted: '1 MB' }
 */
export function formatFileSize(bytes: number): FileSizeFormat {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const threshold = 1024;

  // Handle edge cases
  if (bytes <= 0) {
    return { value: 0, unit: "B", formatted: "0 B" };
  }

  // Handle non-numeric or invalid inputs
  if (!Number.isFinite(bytes)) {
    return { value: 0, unit: "B", formatted: "0 B" };
  }

  let unitIndex = 0;
  let size = bytes;

  // Find the appropriate unit
  while (size >= threshold && unitIndex < units.length - 1) {
    size /= threshold;
    unitIndex++;
  }

  // Format the value
  let value: number;
  if (unitIndex === 0) {
    // For bytes, use integer value
    value = Math.floor(size);
  } else {
    // For other units, round to 2 decimal places
    value = Math.round(size * 100) / 100;
  }

  const unit = units[unitIndex];
  const formatted = `${value} ${unit}`;

  return {
    value,
    unit,
    formatted,
  };
}

/**
 * Simple helper function that returns just the formatted string
 *
 * @param bytes - File size in bytes
 * @returns Formatted file size string (e.g., "1.25 MB")
 */
export function formatFileSizeString(bytes: number): string {
  return formatFileSize(bytes).formatted;
}
