/**
 * Document Converter Service
 *
 * Handles conversion of office documents to PDF format using LibreOffice.
 * Provides input validation, error handling, and timeout management.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.7
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractFileExtension } from "openlib/storage";
import { rimraf } from "rimraf";
import { fetchPublicUrl } from "../http/public-fetch";
import {
  type CircuitBreakerStats,
  getLibreOfficeCircuitBreaker,
} from "../libreoffice/circuit-breaker";
import {
  getLibreOfficeConversionArgs,
  getLibreOfficePath,
  verifyLibreOfficeInstallation,
} from "../libreoffice/libreoffice-utils";
import { getResourceManager } from "../libreoffice/resource-manager";
import { getConversionFileUrl, getConversionStorage } from "./conversion-storage";

export { resetConversionStorage } from "./conversion-storage";

// =============================================================================
// Types
// =============================================================================

/** Configuration for the document converter */
export interface DocumentConverterConfig {
  /** Maximum number of concurrent conversion processes */
  maxConcurrentProcesses: number;
  /** Conversion timeout in milliseconds */
  conversionTimeout: number;
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Writable parent directory for isolated temporary workspaces */
  tempDirectory: string;
  /** Path to LibreOffice executable (optional, will use system default) */
  libreOfficePath?: string;
}

/** Request to convert a document */
export interface ConversionRequest {
  /** URL or path to the file to convert */
  fileUrl: string;
  /** Name of the file */
  fileName: string;
  /** MIME type of the file */
  mimeType: string;
  /** Output format (currently only PDF is supported) */
  outputFormat: "pdf" | "html";
  /**
   * `public` when `fileUrl` is an arbitrary internet address nobody vouched
   * for (a URL a user typed): it is then downloaded with `fetchPublicUrl`,
   * which refuses private and metadata addresses. Default: an address the
   * host resolved itself (its own storage or download route).
   */
  sourceFetch?: "public";
}

/** Result of a conversion operation */
export interface ConversionResult {
  /** Whether the conversion was successful */
  success: boolean;
  /** URL or path to the converted file (if successful) */
  outputUrl?: string;
  /** S3 URI of the converted file (e.g. s3://bucket/conversions/hash.pdf) */
  outputUri?: string;
  /** Error message (if failed) */
  error?: string;
  /** Processing time in milliseconds */
  processingTime: number;
}

/** Metrics for conversion operations */
export interface ConversionMetrics {
  /** Total number of conversions attempted */
  totalConversions: number;
  /** Number of successful conversions */
  successfulConversions: number;
  /** Number of failed conversions */
  failedConversions: number;
  /** Average processing time in milliseconds */
  averageProcessingTime: number;
  /** Current number of active conversions */
  activeConversions: number;
}

type ChildProcessEvents = {
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: DocumentConverterConfig = {
  maxConcurrentProcesses: 3,
  conversionTimeout: 30000, // 30 seconds
  maxFileSize: 500 * 1024 * 1024, // 500MB
  // Writable parent for isolated per-request workspaces (see TempFileSession).
  // Must NOT be a fixed subdirectory: a stale or build-time fixed-owner parent
  // (e.g. a pre-created /tmp/document-converter chowned to a specific UID) is
  // itself a portability/permission hazard across runtime environments.
  tempDirectory: os.tmpdir(),
};

/**
 * Supported file types for conversion
 * Requirements: 2.7 - Validate input file types before processing
 * Comprehensive list of formats that LibreOffice can convert to PDF
 */
export const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  // ===== Word Processing Formats =====
  // Microsoft Word
  "doc",
  "docx",
  "docm",
  "dot",
  "dotx",
  "dotm",
  // OpenDocument Text
  "odt",
  "ott",
  "fodt",
  // Rich Text Format
  "rtf",
  // WordPerfect
  "wpd",
  "wps",
  // Apple Pages
  "pages",
  // Lotus Word Pro
  "lwp",

  // ===== Spreadsheet Formats =====
  // Microsoft Excel
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "xlt",
  "xltx",
  "xltm",
  // OpenDocument Spreadsheet
  "ods",
  "ots",
  "fods",
  // Lotus 1-2-3
  "123",
  "wk1",
  "wk2",
  "wk3",
  "wk4",
  "wks",
  // Apple Numbers
  "numbers",
  // Quattro Pro
  "wb2",
  "wq1",
  "wq2",

  // ===== Presentation Formats =====
  // Microsoft PowerPoint
  "ppt",
  "pptx",
  "pptm",
  "pot",
  "potx",
  "potm",
  "pps",
  "ppsx",
  "ppsm",
  // OpenDocument Presentation
  "odp",
  "otp",
  "fodp",
  // Apple Keynote
  "key",
  "kth",

  // ===== Graphics/Drawing Formats =====
  // OpenDocument Graphics
  "odg",
  "otg",
  // Microsoft Visio
  "vsd",
  "vsdx",
  // CorelDRAW
  "cdr",
  // Windows Metafile
  "wmf",
  "emf",
]);

const SUPPORTED_MIME_TYPES = new Set([
  // ===== Word Processing MIME Types =====
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.ms-word.template.macroEnabled.12",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.text-template",
  "application/rtf",
  "text/rtf",
  "application/vnd.wordperfect",
  "application/vnd.ms-works",
  "application/vnd.apple.pages",
  "application/vnd.lotus-wordpro",

  // ===== Spreadsheet MIME Types =====
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.template.macroEnabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet-template",
  "application/vnd.lotus-1-2-3",
  "application/vnd.apple.numbers",
  "application/x-quattropro",

  // ===== Presentation MIME Types =====
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.template",
  "application/vnd.ms-powerpoint.template.macroEnabled.12",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.presentation-template",
  "application/vnd.apple.keynote",

  // ===== Graphics/Drawing MIME Types =====
  "application/vnd.oasis.opendocument.graphics",
  "application/vnd.oasis.opendocument.graphics-template",
  "application/vnd.visio",
  "application/vnd.ms-visio.drawing",
  "application/vnd.corel-draw",
  "application/x-msmetafile",
  "application/x-emf",
]);

/**
 * Validate the conversion request before any filesystem or LibreOffice work.
 * Requirements: 2.1, 2.7, 8.4
 */
export function validateConversionRequest(request: ConversionRequest): string | null {
  // Validate file name
  if (!request.fileName || request.fileName.trim() === "") {
    return "File name is required";
  }

  // Validate file URL
  if (!request.fileUrl || request.fileUrl.trim() === "") {
    return "File URL is required";
  }

  // Requirements: 8.4 - Validate file name length to prevent DoS
  if (request.fileName.length > 255) {
    return "File name is too long (maximum 255 characters)";
  }

  // Requirements: 8.4 - Validate URL length to prevent DoS
  if (request.fileUrl.length > 2048) {
    return "File URL is too long (maximum 2048 characters)";
  }

  // Validate output format
  if (request.outputFormat !== "pdf" && request.outputFormat !== "html") {
    return `Unsupported output format: ${request.outputFormat}`;
  }

  // Validate file extension (use trimmed file name)
  const extension = getFileExtension(request.fileName.trim());
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    return `Unsupported file type: ${extension || "unknown"}. Supported types: ${Array.from(SUPPORTED_EXTENSIONS).join(", ")}`;
  }

  // Validate MIME type (if provided) - allow partial matches for modern Office formats
  if (request.mimeType) {
    const isSupported =
      SUPPORTED_MIME_TYPES.has(request.mimeType) ||
      Array.from(SUPPORTED_MIME_TYPES).some(
        (mime) => request.mimeType.startsWith(mime) || mime.startsWith(request.mimeType),
      );

    if (!isSupported) {
      return `Unsupported MIME type: ${request.mimeType}`;
    }
  }

  // Requirements: 8.4 - Check for suspicious patterns in file name
  if (containsSuspiciousFileNamePatterns(request.fileName)) {
    return "File name contains suspicious patterns";
  }

  return null;
}

/**
 * Check if a file name contains suspicious patterns that might indicate malicious intent.
 * Requirements: 8.4, 8.6 - Security validation
 */
function containsSuspiciousFileNamePatterns(input: string): boolean {
  // Check for null bytes
  if (input.includes("\0")) {
    return true;
  }

  // Check for path traversal attempts
  if (input.includes("..") || input.includes("/") || input.includes("\\")) {
    return true;
  }

  // Check for control characters (except common whitespace)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally checking for control characters in file names for security
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(input)) {
    return true;
  }

  // Check for script injection patterns
  const scriptPatterns = [/<script/i, /javascript:/i, /onerror=/i, /onload=/i, /eval\(/i];

  return scriptPatterns.some((pattern) => pattern.test(input));
}

/**
 * Get file extension from file name.
 */
function getFileExtension(fileName: string): string | null {
  const parts = fileName.split(".");
  if (parts.length < 2) return null;
  return parts[parts.length - 1].toLowerCase();
}

// =============================================================================
// Temporary File Management
// =============================================================================

/**
 * Temporary file session for managing conversion files
 * Requirements: 2.6, 8.2, 8.3
 */
export class TempFileSession {
  private readonly baseDir: string;
  private sessionDir: string | null = null;
  private cleanedUp = false;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Initialize the temporary directory with secure permissions
   *
   * Creates the session directory atomically as a direct child of `baseDir`
   * via fs.mkdtemp, rather than pre-computing a session ID and mkdir'ing a
   * nested path. This avoids relying on any pre-existing, fixed-owner parent
   * directory (e.g. a build-time chowned /tmp/document-converter) — the only
   * requirement on `baseDir` is that it be a writable directory (typically
   * os.tmpdir()), and mkdtemp both creates and names the workspace in one
   * atomic, collision-free step.
   *
   * Requirements: 2.6 - Create temporary directories with proper permissions
   */
  async initialize(): Promise<void> {
    if (this.sessionDir) {
      return;
    }

    this.sessionDir = await fs.mkdtemp(path.join(this.baseDir, "document-converter-"));
    // mkdtemp is private on POSIX already; enforce the contract explicitly and
    // fail closed if the underlying filesystem cannot apply it.
    if (process.platform !== "win32") {
      await fs.chmod(this.sessionDir, 0o700);
    }
  }

  /**
   * Get a safe path within the session directory
   * Requirements: 8.2, 8.3 - Validate and sanitize file paths, prevent directory traversal
   */
  getSafePath(fileName: string): string {
    // Sanitize the file name to prevent directory traversal
    const sanitized = this.sanitizeFileName(fileName);
    const fullPath = path.join(this.getSessionDir(), sanitized);

    // Verify the resolved path is still within the session directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedSessionDir = path.resolve(this.getSessionDir());

    if (
      !resolvedPath.startsWith(resolvedSessionDir + path.sep) &&
      resolvedPath !== resolvedSessionDir
    ) {
      throw new Error("Invalid file path: directory traversal detected");
    }

    return fullPath;
  }

  /**
   * Sanitize a file name to prevent security issues
   * Requirements: 8.2 - Validate and sanitize input file paths
   */
  private sanitizeFileName(fileName: string): string {
    // Remove any path separators and null bytes
    let sanitized = fileName.replace(/[/\\]/g, "_").replace(/\0/g, "");

    // Remove leading dots to prevent hidden files
    sanitized = sanitized.replace(/^\.+/, "");

    // Remove any remaining dangerous characters
    sanitized = sanitized.replace(/[<>:"|?*]/g, "_");

    // Ensure the filename is not empty after sanitization
    if (sanitized.trim() === "") {
      sanitized = `file_${Date.now()}`;
    }

    return sanitized;
  }

  /**
   * Clean up all temporary files in this session
   * Requirements: 2.6 - Add automatic cleanup after conversion
   */
  async cleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    if (!this.sessionDir) {
      return;
    }

    try {
      // Use rimraf for robust directory removal
      await rimraf(this.sessionDir, { maxRetries: 3 });
      this.cleanedUp = true;
    } catch (error) {
      // Log error but don't throw - cleanup is best-effort
      console.error(`Failed to cleanup temp directory ${this.sessionDir}:`, error);
    }
  }

  /**
   * Get the session directory path
   */
  getSessionDir(): string {
    if (!this.sessionDir) {
      throw new Error("TempFileSession not initialized: call initialize() first");
    }
    return this.sessionDir;
  }

  /**
   * Check if cleanup has been performed
   */
  isCleanedUp(): boolean {
    return this.cleanedUp;
  }
}

/**
 * Validate a file path to ensure it's safe
 * Requirements: 8.2, 8.3 - Path validation and directory traversal prevention
 */
export function validateFilePath(filePath: string, baseDir: string): boolean {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedBaseDir = path.resolve(baseDir);

    // Check if the path is within the base directory
    return resolvedPath.startsWith(resolvedBaseDir + path.sep) || resolvedPath === resolvedBaseDir;
  } catch {
    return false;
  }
}

/**
 * Sanitize a file path by removing dangerous components
 * Requirements: 8.2 - Validate and sanitize input file paths
 */
export function sanitizeFilePath(filePath: string): string {
  // Remove null bytes
  let sanitized = filePath.replace(/\0/g, "");

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, "/");

  // Remove any .. components to prevent traversal
  const parts = sanitized.split("/").filter((part) => part !== ".." && part !== ".");

  return parts.join(path.sep);
}

// =============================================================================
// Document Converter Class
// =============================================================================

export class DocumentConverter {
  private readonly config: DocumentConverterConfig;
  private activeConversions = 0;
  private metrics: ConversionMetrics = {
    totalConversions: 0,
    successfulConversions: 0,
    failedConversions: 0,
    averageProcessingTime: 0,
    activeConversions: 0,
  };
  private totalProcessingTime = 0;
  private readonly circuitBreaker = getLibreOfficeCircuitBreaker();
  private readonly resourceManager = getResourceManager();

  constructor(config: Partial<DocumentConverterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start automatic zombie process cleanup
    // Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
    this.resourceManager.startZombieCleanup();
  }

  /**
   * Convert a document to the specified output format
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 6.6, 7.2, 7.3, 8.4, 8.6
   */
  async convert(request: ConversionRequest): Promise<ConversionResult> {
    const startTime = Date.now();
    let tempSession: TempFileSession | null = null;

    try {
      // Validate input
      // Requirements: 2.7 - Validate input file types before processing
      const validationError = validateConversionRequest(request);
      if (validationError) {
        this.metrics.totalConversions++;
        this.metrics.failedConversions++;
        return {
          success: false,
          error: validationError,
          processingTime: Date.now() - startTime,
        };
      }

      // Check concurrent process limit
      if (this.activeConversions >= this.config.maxConcurrentProcesses) {
        this.metrics.totalConversions++;
        this.metrics.failedConversions++;
        return {
          success: false,
          error: "Maximum concurrent conversions reached. Please try again later.",
          processingTime: Date.now() - startTime,
        };
      }

      this.activeConversions++;
      this.metrics.activeConversions = this.activeConversions;

      // Create temporary file session
      // Requirements: 2.6 - Create temporary directories with proper permissions
      tempSession = new TempFileSession(this.config.tempDirectory);
      await tempSession.initialize();

      // Perform conversion with circuit breaker, timeout, and memory monitoring
      // Requirements: 6.6 - Implement circuit breaker pattern for LibreOffice service failures
      // Requirements: 7.2 - Implement conversion timeouts to prevent hanging processes
      // Requirements: 7.3 - Monitor memory usage during conversion operations
      const conversionOutput = await this.resourceManager.withTimeout(async () => {
        return await this.resourceManager.withMemoryMonitoring(async () => {
          return await this.circuitBreaker.execute(async () => {
            return await this.performConversion(request, tempSession as TempFileSession);
          });
        });
      }, this.config.conversionTimeout);

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.metrics.totalConversions++;
      this.metrics.successfulConversions++;
      this.totalProcessingTime += processingTime;
      this.metrics.averageProcessingTime = this.totalProcessingTime / this.metrics.totalConversions;

      // Requirements: 2.3 - Return the converted document URL or file path
      return {
        success: true,
        outputUrl: conversionOutput.presignedUrl,
        outputUri: conversionOutput.uri,
        processingTime,
      };
    } catch (error) {
      // Requirements: 2.4 - Return descriptive error information when conversion fails
      // Requirements: 6.5 - Log conversion errors for debugging and monitoring
      const processingTime = Date.now() - startTime;
      this.metrics.totalConversions++;
      this.metrics.failedConversions++;
      this.totalProcessingTime += processingTime;
      this.metrics.averageProcessingTime = this.totalProcessingTime / this.metrics.totalConversions;

      return {
        success: false,
        error: this.getErrorMessage(error),
        processingTime,
      };
    } finally {
      this.activeConversions--;
      this.metrics.activeConversions = this.activeConversions;

      // Requirements: 2.6 - Add automatic cleanup after conversion
      if (tempSession) {
        await tempSession.cleanup();
      }
    }
  }

  /**
   * Check if the LibreOffice service is healthy and available
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check if LibreOffice is installed and accessible
      const verification = await verifyLibreOfficeInstallation();
      if (!verification.installed) {
        console.error("[DocumentConverter] LibreOffice not available:", verification.error);
        return false;
      }

      // Check if temp directory exists and is writable
      await fs.access(this.config.tempDirectory, fs.constants.W_OK);
      return true;
    } catch {
      try {
        // Try to create temp directory
        await fs.mkdir(this.config.tempDirectory, { recursive: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get the LibreOffice executable path
   * Requirements: 1.1 - Support multiple platforms (macOS, Linux/Docker)
   */
  async getLibreOfficePath(): Promise<string> {
    // Use configured path if provided
    if (this.config.libreOfficePath) {
      return this.config.libreOfficePath;
    }

    // Otherwise auto-detect
    return await getLibreOfficePath();
  }

  /**
   * Get conversion metrics
   */
  getMetrics(): ConversionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker statistics
   * Requirements: 6.6 - Monitor circuit breaker state
   */
  getCircuitBreakerStats(): CircuitBreakerStats {
    return this.circuitBreaker.getStats();
  }

  /**
   * Get resource manager statistics
   * Requirements: 7.3, 7.6 - Monitor memory usage and zombie process cleanup
   */
  getResourceStats() {
    return this.resourceManager.getStats();
  }

  /**
   * Shutdown the document converter and cleanup resources
   * Requirements: 7.6 - Clean up zombie LibreOffice processes automatically
   */
  async shutdown(): Promise<void> {
    await this.resourceManager.shutdown();
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      totalConversions: 0,
      successfulConversions: 0,
      failedConversions: 0,
      averageProcessingTime: 0,
      activeConversions: this.activeConversions,
    };
    this.totalProcessingTime = 0;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Perform the actual conversion
   * This is a placeholder that will be implemented with actual LibreOffice integration
   * Requirements: 8.4 - Validate file size before conversion
   */
  private async performConversion(
    request: ConversionRequest,
    tempSession: TempFileSession,
  ): Promise<{ uri: string; presignedUrl: string }> {
    const logPrefix = "[DocumentConverter]";

    // 1. Download the file from fileUrl to a temp location
    const inputFilePath = tempSession.getSafePath(request.fileName);
    console.log(`${logPrefix} Step 1: Downloading file`);
    console.log(`${logPrefix}   - request.fileName: "${request.fileName}"`);
    console.log(`${logPrefix}   - inputFilePath: "${inputFilePath}"`);
    // A staged source's path is a private read capability too.
    console.log(`${logPrefix}   - input origin: "${new URL(request.fileUrl).origin}"`);
    await this.downloadFile(request.fileUrl, inputFilePath, request.sourceFetch);

    // Verify input file was downloaded
    try {
      const inputStats = await fs.stat(inputFilePath);
      console.log(`${logPrefix}   - Downloaded file size: ${inputStats.size} bytes`);
    } catch (e) {
      console.error(`${logPrefix}   - ERROR: Input file not found after download!`);
      throw e;
    }

    // 2. Requirements: 8.4 - Validate file size doesn't exceed maxFileSize
    const sizeValidation = await this.validateFileSize(inputFilePath);
    if (!sizeValidation.valid) {
      throw new Error(sizeValidation.error);
    }

    // 3. Get LibreOffice path
    const libreOfficePath = await this.getLibreOfficePath();
    console.log(`${logPrefix} Step 3: LibreOffice path: "${libreOfficePath}"`);

    // 4. Get conversion args
    // Note: LibreOffice uses --outdir to specify output directory
    // The output filename is automatically derived from input filename but with new extension
    const outputDir = tempSession.getSessionDir();

    // CRITICAL: Create a unique user profile directory for this conversion
    // This prevents LibreOffice single-instance conflicts in Docker/concurrent scenarios
    // Without this, LibreOffice silently fails (exit 0, no output) when another instance is running
    const userProfileDir = path.join(outputDir, ".libreoffice-profile");
    await fs.mkdir(userProfileDir, { recursive: true, mode: 0o700 });
    console.log(`${logPrefix} Step 4: Created unique user profile dir: "${userProfileDir}"`);

    const args = getLibreOfficeConversionArgs(
      inputFilePath,
      outputDir,
      request.outputFormat,
      userProfileDir,
    );
    console.log(`${logPrefix} Step 4: Conversion args`);
    console.log(`${logPrefix}   - outputDir: "${outputDir}"`);
    console.log(`${logPrefix}   - userProfileDir: "${userProfileDir}"`);
    console.log(`${logPrefix}   - args: ${JSON.stringify(args)}`);
    console.log(`${logPrefix}   - Full command: "${libreOfficePath}" ${args.join(" ")}`);

    // 5. Execute LibreOffice with proper locale and encoding environment variables
    // This ensures proper handling of Chinese and other CJK characters
    console.log(`${logPrefix} Step 5: Executing LibreOffice...`);

    // Additional diagnostics: Check if LibreOffice binary exists and is executable
    try {
      const binaryStats = await fs.stat(libreOfficePath);
      console.log(`${logPrefix}   - LibreOffice binary exists, size: ${binaryStats.size} bytes`);
      // Check if it's a symlink
      const realPath = await fs.realpath(libreOfficePath);
      if (realPath !== libreOfficePath) {
        console.log(`${logPrefix}   - LibreOffice is symlink to: "${realPath}"`);
      }
    } catch (e) {
      console.error(`${logPrefix}   - ERROR checking LibreOffice binary: ${e}`);
    }

    let stdout = "";
    let stderr = "";

    await new Promise((resolve, reject) => {
      // Set environment variables for proper UTF-8 encoding and locale support
      // Extract current environment variables to avoid linter issues
      const currentEnv = process.env;
      const env = {
        ...currentEnv,
        LANG: currentEnv.LANG || "en_US.UTF-8",
        LC_ALL: currentEnv.LC_ALL || "en_US.UTF-8",
        LC_CTYPE: currentEnv.LC_CTYPE || "en_US.UTF-8",
        // CRITICAL: Set HOME to ensure LibreOffice can find/create its profile
        HOME: currentEnv.HOME || "/home/nextjs",
        // CRITICAL: Force headless mode by disabling X11 display
        // Even with --headless flag, LibreOffice may try to connect to X11
        // Setting DISPLAY to empty string prevents X11 connection attempts
        // This is essential for Docker/server environments without X11
        DISPLAY: "",
        // Use headless VCL plugin instead of X11-based ones
        // 'svp' = Server Virtual Plugin (pure headless, no X11 dependency)
        SAL_USE_VCLPLUGIN: "svp",
      };

      console.log(`${logPrefix}   - HOME env: "${env.HOME}"`);
      console.log(`${logPrefix}   - USER env: "${currentEnv.USER || "not set"}"`);
      console.log(`${logPrefix}   - DISPLAY env: "${env.DISPLAY}" (empty = headless)`);
      console.log(`${logPrefix}   - SAL_USE_VCLPLUGIN: "${env.SAL_USE_VCLPLUGIN}"`);

      const libreOfficeProcess: ChildProcess = spawn(libreOfficePath, args, {
        env,
        // Capture both stdout and stderr for debugging
        stdio: ["ignore", "pipe", "pipe"],
      });
      const libreOfficeEvents = libreOfficeProcess as unknown as ChildProcessEvents;

      // Capture stdout
      libreOfficeProcess.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf8");
      });

      // Capture stderr for error reporting
      libreOfficeProcess.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf8");
      });

      libreOfficeEvents.on("close", (code: number | null) => {
        console.log(`${logPrefix}   - Exit code: ${code}`);
        if (stdout) console.log(`${logPrefix}   - stdout: ${stdout}`);
        if (stderr) console.log(`${logPrefix}   - stderr: ${stderr}`);

        if (code === 0) {
          resolve(undefined);
        } else {
          reject(new Error(`LibreOffice conversion failed with code ${code}: ${stderr}`));
        }
      });

      libreOfficeEvents.on("error", (err: Error) => {
        reject(new Error(`Failed to start LibreOffice process: ${err.message}`));
      });
    });

    // 6. Verify output file exists
    // LibreOffice creates the output file with the same name but new extension
    // IMPORTANT: Use the actual input file's basename (after sanitization), not request.fileName
    // LibreOffice outputs based on the actual filename on disk, which may differ from request.fileName
    // after sanitization by getSafePath()

    // Construct expected output path based on actual input file's basename + new extension
    const inputFileBasename = path.parse(inputFilePath).name;
    const expectedOutputName = `${inputFileBasename}.${request.outputFormat}`;
    const actualOutputPath = path.join(outputDir, expectedOutputName);

    console.log(`${logPrefix} Step 6: Checking for output file`);
    console.log(`${logPrefix}   - inputFileBasename: "${inputFileBasename}"`);
    console.log(`${logPrefix}   - expectedOutputName: "${expectedOutputName}"`);
    console.log(`${logPrefix}   - actualOutputPath: "${actualOutputPath}"`);

    // List all files in output directory for debugging
    try {
      const filesInOutputDir = await fs.readdir(outputDir);
      console.log(`${logPrefix}   - Files in outputDir: ${JSON.stringify(filesInOutputDir)}`);

      // Also check for any subdirectories that LibreOffice might have created
      for (const file of filesInOutputDir) {
        const filePath = path.join(outputDir, file);
        const stat = await fs.stat(filePath);
        console.log(
          `${logPrefix}     - "${file}" (${stat.isDirectory() ? "dir" : "file"}, ${stat.size} bytes)`,
        );

        // If it's a directory, list its contents too
        if (stat.isDirectory()) {
          const subFiles = await fs.readdir(filePath);
          console.log(`${logPrefix}       - Contents: ${JSON.stringify(subFiles)}`);
        }
      }
    } catch (e) {
      console.error(`${logPrefix}   - ERROR listing outputDir: ${e}`);
    }

    try {
      await fs.access(actualOutputPath);
      const outputStats = await fs.stat(actualOutputPath);
      console.log(`${logPrefix}   - Output file found! Size: ${outputStats.size} bytes`);
    } catch {
      // Try to find any PDF/HTML file in the output directory as fallback
      const filesInOutputDir = await fs.readdir(outputDir);
      const outputExtension = request.outputFormat;
      const possibleOutputFiles = filesInOutputDir.filter((f) =>
        f.toLowerCase().endsWith(`.${outputExtension}`),
      );
      console.error(`${logPrefix}   - ERROR: Expected output not found at "${actualOutputPath}"`);
      console.error(
        `${logPrefix}   - Possible output files with .${outputExtension} extension: ${JSON.stringify(possibleOutputFiles)}`,
      );

      throw new Error(
        `Conversion completed but output file not found at ${actualOutputPath}. ` +
          `Files in output dir: ${JSON.stringify(filesInOutputDir)}. ` +
          `Possible matches: ${JSON.stringify(possibleOutputFiles)}`,
      );
    }

    // 7. Security scan the converted file before uploading
    // Requirements: 8.6 - Scan converted documents for potential security issues
    const securityScanResult = await this.scanConvertedDocument(actualOutputPath);
    if (!securityScanResult.safe) {
      throw new Error(`Security scan failed: ${securityScanResult.reason}`);
    }

    // 8. Upload converted file to conversion storage and return an accessible URL.
    //
    // We use getConversionStorage() (NOT the global `storage` singleton) so that
    // converted PDFs never land in the main user-attachment bucket (STORAGE_URL).
    // When PREVIEWFILE_STORAGE_URL / BUDA_DRIVE_URL resolves to local://, the
    // returned presignedUrl is a same-origin /api/convert/pdf-file/<key> path —
    // no CORS issues, no expiry, browser can always fetch it.
    const convertedFileBuffer = await fs.readFile(actualOutputPath);
    const fileHash = createHash("sha256").update(convertedFileBuffer).digest("hex");
    const fileExtension = extractFileExtension(expectedOutputName);

    // Use a storage key pattern: conversions/{hash}.{extension}
    const storageKey = `conversions/${fileHash}${fileExtension ? `.${fileExtension}` : ""}`;

    const conversionStore = getConversionStorage();
    const { uri } = await conversionStore.uploadFileToKey(
      convertedFileBuffer,
      storageKey,
      request.outputFormat === "pdf" ? "application/pdf" : "text/html",
    );

    // For local storage this returns a same-origin path (no expiry, no CORS).
    // For S3/R2 storage this returns a presigned URL (Buda's /api/convert/pdf
    // proxy will wrap it before sending to the browser — see convert/route.ts).
    const presignedUrl = await getConversionFileUrl(uri, 3600);

    return { uri, presignedUrl };
  }

  /**
   * Helper to download a file from a URL to a local path
   */
  private async downloadFile(
    url: string,
    destPath: string,
    sourceFetch?: ConversionRequest["sourceFetch"],
  ): Promise<void> {
    let response: Response;
    try {
      response =
        sourceFetch === "public"
          ? await fetchPublicUrl(url, undefined, { maxBytes: this.config.maxFileSize })
          : await fetch(url, { redirect: "error" });
    } catch (fetchError) {
      // Provide more detailed error message for network failures
      throw new Error("Failed to fetch source file", { cause: fetchError });
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: HTTP ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    // Use stream to write file to avoid memory issues with large files
    const fileHandle = await fs.open(destPath, "w");
    const stream = fileHandle.createWriteStream();

    // Convert Web ReadableStream to Node WritableStream
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stream.write(value);
      }
    } finally {
      stream.end();
      await new Promise<void>((resolve, reject) => {
        stream.on("finish", () => resolve());
        stream.on("error", reject);
      });
      await fileHandle.close();
    }
  }

  /**
   * Validate file size to prevent DoS attacks
   * Requirements: 8.4 - Limit file size for conversion to prevent DoS attacks
   */
  async validateFileSize(
    filePath: string,
  ): Promise<{ valid: boolean; error?: string; size?: number }> {
    try {
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      if (fileSize > this.config.maxFileSize) {
        return {
          valid: false,
          error: `File size (${this.formatFileSize(fileSize)}) exceeds maximum allowed size (${this.formatFileSize(this.config.maxFileSize)})`,
          size: fileSize,
        };
      }

      // Also check for suspiciously small files (potential bombs or corrupted files)
      if (fileSize < 10) {
        return {
          valid: false,
          error: "File is too small to be a valid document",
          size: fileSize,
        };
      }

      return { valid: true, size: fileSize };
    } catch (error) {
      return {
        valid: false,
        error: `Failed to check file size: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Format file size in human-readable format
   */
  private formatFileSize(bytes: number): string {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Scan converted document for potential security issues
   * Requirements: 8.6 - Scan converted documents for potential security issues
   */
  private async scanConvertedDocument(
    filePath: string,
  ): Promise<{ safe: boolean; reason?: string }> {
    try {
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist - this is expected for placeholder implementation
        // In production, this would be a real file from LibreOffice conversion
        // For now, we'll consider it safe since it's just a placeholder path
        return { safe: true };
      }

      // Validate file size of converted document
      const sizeValidation = await this.validateFileSize(filePath);
      if (!sizeValidation.valid) {
        return { safe: false, reason: sizeValidation.error };
      }

      // Check for suspicious file size (potential zip bomb or decompression bomb)
      // If the converted file is significantly larger than the max size, it might be malicious
      if (sizeValidation.size && sizeValidation.size > this.config.maxFileSize * 2) {
        return {
          safe: false,
          reason: "Converted file size is suspiciously large (potential decompression bomb)",
        };
      }

      // Basic content scanning for PDF files
      if (filePath.endsWith(".pdf")) {
        const scanResult = await this.scanPdfContent(filePath);
        if (!scanResult.safe) {
          return scanResult;
        }
      }

      // All checks passed
      return { safe: true };
    } catch (error) {
      console.error("Error during security scan:", error);
      // Fail closed - if we can't scan, consider it unsafe
      return {
        safe: false,
        reason: `Security scan failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Scan PDF content for suspicious patterns
   * Requirements: 8.6 - Basic security scanning of converted documents
   *
   * Note: LibreOffice-generated PDFs may contain standard PDF features like /OpenAction
   * (for initial view settings) or /AA (Additional Actions for form fields). These are
   * legitimate and should not be flagged. We only flag actual JavaScript execution patterns.
   */
  private async scanPdfContent(filePath: string): Promise<{ safe: boolean; reason?: string }> {
    try {
      // Read first 16KB of the file for header analysis (increased for better detection)
      const buffer = Buffer.alloc(16384);
      const fileHandle = await fs.open(filePath, "r");

      try {
        await fileHandle.read(buffer, 0, 16384, 0);
      } finally {
        await fileHandle.close();
      }

      const content = buffer.toString("utf-8", 0, Math.min(buffer.length, 16384));

      // Check for valid PDF header
      if (!content.startsWith("%PDF-")) {
        return { safe: false, reason: "Invalid PDF header" };
      }

      // Only flag actual JavaScript execution - not standard PDF actions
      // LibreOffice PDFs legitimately use /OpenAction for initial view settings
      // and /AA for form field behaviors. These are NOT security risks.
      //
      // We specifically check for:
      // - /JavaScript or /JS with actual script content
      // - /Launch (external application execution)
      // - /SubmitForm (data exfiltration)
      // - /ImportData (external data loading)
      const dangerousPatterns = [
        /\/JavaScript\s*<</, // JavaScript dictionary (actual JS code)
        /\/JS\s*\(/, // JavaScript string literal
        /\/JS\s*<</, // JavaScript stream
        /\/Launch/, // Launch external application
        /\/SubmitForm/, // Submit form data externally
        /\/ImportData/, // Import external data
        /\/URI\s*\(javascript:/i, // JavaScript URI scheme
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
          return {
            safe: false,
            reason: "PDF contains potentially malicious JavaScript or external actions",
          };
        }
      }

      // Check for embedded files (potential malware delivery)
      if (content.includes("/EmbeddedFile")) {
        return {
          safe: false,
          reason: "PDF contains embedded files which are not allowed",
        };
      }

      return { safe: true };
    } catch (error) {
      console.error("Error scanning PDF content:", error);
      // Fail closed
      return {
        safe: false,
        reason: `PDF scan failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get user-friendly error message from error object
   * Requirements: 2.4 - Return descriptive error information
   * Requirements: 6.5 - Log conversion errors for debugging and monitoring
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      // Check for circuit breaker errors
      if (error.name === "CircuitBreakerOpenError") {
        return "Conversion service temporarily unavailable. Please try again later.";
      }
      // Check for timeout errors
      // Requirements: 7.2 - Handle conversion timeouts
      if (error.name === "TimeoutError") {
        return "Conversion timed out. The document may be too large or complex.";
      }
      // Check for specific error types
      if (error.message.includes("ENOENT")) {
        return "File not found or inaccessible";
      }
      if (error.message.includes("EACCES")) {
        return "Permission denied accessing file";
      }
      if (error.message.includes("timeout")) {
        return "Conversion timed out. The document may be too large or complex.";
      }
      if (error.message.includes("ENOMEM")) {
        return "Insufficient memory to complete conversion";
      }
      return error.message;
    }
    return "An unknown error occurred during conversion";
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let converterInstance: DocumentConverter | null = null;

/**
 * Get the singleton document converter instance
 */
export function getDocumentConverter(config?: Partial<DocumentConverterConfig>): DocumentConverter {
  if (!converterInstance) {
    converterInstance = new DocumentConverter(config);
  }
  return converterInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetDocumentConverter(): void {
  converterInstance = null;
}
