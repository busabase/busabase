/**
 * File Validation Utilities
 *
 * Provides validation functions for uploaded files to ensure they meet
 * size, type, and other requirements before processing.
 *
 * Requirements: 2.2, 2.3
 */

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export interface FileValidationOptions {
  maxSizeBytes?: number;
  allowedTypes?: string[];
  allowedExtensions?: string[];
}

const DEFAULT_MAX_SIZE = 500 * 1024 * 1024; // 500MB
const DEFAULT_ALLOWED_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // eBooks
  "application/epub+zip",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
  "image/svg+xml",
  "image/bmp",
  // Text
  "text/plain",
  "text/csv",
  "text/markdown",
  // Video
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/mpeg",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/silk",
  "audio/x-silk",
  "application/x-silk",
  "application/octet-stream",
  // 3D Models
  "model/gltf-binary",
  "model/gltf+json",
  // Archives (for reference, usually download-only)
  "application/zip",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-rar",
  "application/rar",
  "application/x-7z-compressed",
];

const DEFAULT_ALLOWED_EXTENSIONS = [
  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  // eBooks
  ".epub",
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".tif",
  ".svg",
  ".bmp",
  // Text
  ".txt",
  ".csv",
  ".md",
  ".markdown",
  // Video
  ".mp4",
  ".webm",
  ".ogg",
  ".ogv",
  ".mov",
  ".avi",
  ".mkv",
  ".mpeg",
  ".mpg",
  // Audio
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".aac",
  ".silk",
  ".slk",
  // 3D Models
  ".obj",
  ".stl",
  ".gltf",
  ".glb",
  ".fbx",
  // Archives
  ".zip",
  ".rar",
  ".7z",
];

/**
 * Validate file size
 */
export function validateFileSize(
  file: File,
  maxSizeBytes: number = DEFAULT_MAX_SIZE,
): FileValidationResult {
  if (file.size > maxSizeBytes) {
    return {
      isValid: false,
      error: `File size exceeds maximum allowed size of ${formatBytes(maxSizeBytes)}`,
    };
  }
  return { isValid: true };
}

/**
 * Validate file type against allowed MIME types
 */
export function validateFileType(
  file: File,
  allowedTypes: string[] = DEFAULT_ALLOWED_TYPES,
): FileValidationResult {
  if (!file.type) {
    return { isValid: true }; // Allow files without type
  }

  if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `File type "${file.type}" is not supported`,
    };
  }

  return { isValid: true };
}

/**
 * Validate file extension
 */
export function validateFileExtension(
  file: File,
  allowedExtensions: string[] = DEFAULT_ALLOWED_EXTENSIONS,
): FileValidationResult {
  const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;

  if (allowedExtensions.length > 0 && !allowedExtensions.includes(extension)) {
    return {
      isValid: false,
      error: `File extension "${extension}" is not supported`,
    };
  }

  return { isValid: true };
}

/**
 * Comprehensive file validation
 */
export function validateFile(
  file: File,
  options: FileValidationOptions = {},
): FileValidationResult {
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE;
  const allowedTypes = options.allowedTypes ?? DEFAULT_ALLOWED_TYPES;
  const allowedExtensions = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;

  const sizeResult = validateFileSize(file, maxSizeBytes);
  if (!sizeResult.isValid) {
    return sizeResult;
  }

  const typeResult = validateFileType(file, allowedTypes);
  if (!typeResult.isValid) {
    return typeResult;
  }

  const extensionResult = validateFileExtension(file, allowedExtensions);
  if (!extensionResult.isValid) {
    return extensionResult;
  }

  return { isValid: true };
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Check if file is an image
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * Check if file is a document
 */
export function isDocumentFile(file: File): boolean {
  return (
    file.type.includes("pdf") ||
    file.type.includes("word") ||
    file.type.includes("excel") ||
    file.type.includes("powerpoint") ||
    file.type.includes("text")
  );
}
