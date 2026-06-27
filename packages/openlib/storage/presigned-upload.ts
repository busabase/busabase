/**
 * Reusable helpers for presigned URL upload pattern
 *
 * This module provides utilities for implementing the three-step upload workflow:
 * 1. Request presigned URL from server
 * 2. Upload file directly to S3 using presigned URL
 * 3. Confirm upload to server to create database record
 */

import { nanoid } from "nanoid";
import type { S3Storage } from "./s3";

/**
 * Options for generating storage key
 */
export interface GenerateStorageKeyOptions {
  /** Base path prefix (e.g., "entities/123/documents") */
  prefix: string;
  /** File extension (with or without dot) */
  fileExtension?: string;
  /** Custom filename (if not provided, uses nanoid) */
  customFilename?: string;
  /** Length of nanoid for unique ID (default: 12) */
  idLength?: number;
}

/**
 * Generate unique storage key for S3
 *
 * @param options - Storage key generation options
 * @returns Unique storage key path
 *
 * @example
 * ```ts
 * const key = generateStorageKey({
 *   prefix: 'entities/abc123/documents',
 *   fileExtension: 'pdf',
 * });
 * // Returns: "entities/abc123/documents/vY3kL9mN4pQ2.pdf"
 * ```
 */
export function generateStorageKey(options: GenerateStorageKeyOptions): string {
  const { prefix, fileExtension, customFilename, idLength = 12 } = options;

  // Normalize file extension (remove leading dot if present)
  const ext = fileExtension
    ? fileExtension.startsWith(".")
      ? fileExtension
      : `.${fileExtension}`
    : "";

  // Use custom filename or generate unique ID
  const filename = customFilename || nanoid(idLength);

  // Ensure prefix doesn't end with slash
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

  return `${normalizedPrefix}/${filename}${ext}`;
}

/**
 * Request presigned upload URL from S3 storage
 *
 * @param storage - S3Storage instance
 * @param options - Storage key generation options
 * @param mimeType - File MIME type
 * @param expiresIn - URL expiration in seconds (default: 3600)
 * @returns Object containing upload URL and storage key
 *
 * @example
 * ```ts
 * const { uploadUrl, storageKey } = await requestPresignedUploadUrl(
 *   storage,
 *   { prefix: 'uploads/documents', fileExtension: 'pdf' },
 *   'application/pdf'
 * );
 * ```
 */
export async function requestPresignedUploadUrl(
  storage: S3Storage,
  options: GenerateStorageKeyOptions,
  mimeType: string,
  expiresIn = 3600,
): Promise<{ uploadUrl: string; storageKey: string }> {
  const storageKey = generateStorageKey(options);
  const uploadUrl = await storage.generateUploadPresignedUrl(storageKey, mimeType, expiresIn);

  return { uploadUrl, storageKey };
}

/**
 * Upload file to S3 using presigned URL
 *
 * @param presignedUrl - Presigned upload URL from S3
 * @param file - File content (Buffer, Blob, string, or ArrayBuffer)
 * @param mimeType - File MIME type
 * @returns Response from S3
 *
 * @example
 * ```ts
 * const buffer = Buffer.from(await file.arrayBuffer());
 * const response = await uploadToS3WithPresignedUrl(
 *   uploadUrl,
 *   buffer,
 *   'application/pdf'
 * );
 *
 * if (!response.ok) {
 *   throw new Error('Upload failed');
 * }
 * ```
 */
export async function uploadToS3WithPresignedUrl(
  presignedUrl: string,
  file: Buffer | Blob | string | ArrayBuffer,
  mimeType: string,
): Promise<Response> {
  return await fetch(presignedUrl, {
    method: "PUT",
    body: file as BodyInit,
    headers: {
      "Content-Type": mimeType,
    },
  });
}

/**
 * Extract file extension from filename
 *
 * @param filename - Original filename
 * @returns File extension without dot, or empty string
 *
 * @example
 * ```ts
 * extractFileExtension('document.pdf') // Returns: 'pdf'
 * extractFileExtension('archive.tar.gz') // Returns: 'gz'
 * extractFileExtension('no-extension') // Returns: ''
 * ```
 */
export function extractFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length < 2) return "";
  const ext = parts[parts.length - 1];
  return ext ? ext.toLowerCase() : "";
}

/**
 * Validate file size against maximum limit
 *
 * @param fileSize - Size in bytes
 * @param maxSize - Maximum allowed size in bytes
 * @throws Error if file size exceeds limit
 *
 * @example
 * ```ts
 * const MAX_SIZE = 50 * 1024 * 1024; // 50MB
 * validateFileSize(file.size, MAX_SIZE);
 * ```
 */
export function validateFileSize(fileSize: number, maxSize: number): void {
  if (fileSize > maxSize) {
    const maxSizeMB = (maxSize / 1024 / 1024).toFixed(0);
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
    throw new Error(`File size ${fileSizeMB}MB exceeds maximum limit of ${maxSizeMB}MB`);
  }
}

/**
 * Validate file MIME type against allowed types
 *
 * @param mimeType - File MIME type
 * @param allowedTypes - Array of allowed MIME types or patterns
 * @throws Error if MIME type is not allowed
 *
 * @example
 * ```ts
 * validateMimeType('application/pdf', [
 *   'application/pdf',
 *   'image/*',
 *   'text/plain'
 * ]);
 * ```
 */
export function validateMimeType(mimeType: string, allowedTypes: string[]): void {
  const isAllowed = allowedTypes.some((allowed) => {
    if (allowed.endsWith("/*")) {
      const prefix = allowed.slice(0, -2);
      return mimeType.startsWith(prefix);
    }
    return mimeType === allowed;
  });

  if (!isAllowed) {
    throw new Error(
      `File type ${mimeType} is not allowed. Allowed types: ${allowedTypes.join(", ")}`,
    );
  }
}

/**
 * Format bytes to human-readable size
 *
 * @param bytes - Size in bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "1.5 MB")
 *
 * @example
 * ```ts
 * formatBytes(1536) // Returns: "1.5 KB"
 * formatBytes(1048576) // Returns: "1 MB"
 * formatBytes(5242880, 0) // Returns: "5 MB"
 * ```
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${Number.parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}
