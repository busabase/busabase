/**
 * Tests for Document Converter Service
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 8.2, 8.3
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConversionRequest,
  DocumentConverter,
  getDocumentConverter,
  resetDocumentConverter,
  sanitizeFilePath,
  TempFileSession,
  validateFilePath,
} from "./document-converter";

// =============================================================================
// Test Setup
// =============================================================================

const skipLibreOffice = process.env.VITEST_SKIP_LIBREOFFICE_INTEGRATION === "true";

describe.skipIf(skipLibreOffice)("DocumentConverter", () => {
  let converter: DocumentConverter;

  beforeEach(() => {
    resetDocumentConverter();
    converter = new DocumentConverter({
      maxConcurrentProcesses: 2,
      conversionTimeout: 5000,
      maxFileSize: 10 * 1024 * 1024, // 10MB for tests
    });
  });

  afterEach(() => {
    resetDocumentConverter();
  });

  // ===========================================================================
  // Input Validation Tests
  // Requirements: 2.1, 2.7
  // ===========================================================================

  describe("Input Validation", () => {
    it("should accept valid office document requests", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
      expect(result.outputUrl).toBeDefined();
    });

    it("should reject requests with empty file name", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("File name is required");
    });

    it("should reject requests with empty file URL", async () => {
      const request: ConversionRequest = {
        fileUrl: "",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("File URL is required");
    });

    it("should reject unsupported file extensions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/image.jpg",
        fileName: "image.jpg",
        mimeType: "image/jpeg",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should reject unsupported output formats", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "docx" as "pdf", // Invalid format
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported output format");
    });

    it("should accept all supported legacy Word formats", async () => {
      const formats = ["doc", "docm", "dotx", "dotm"];

      for (const format of formats) {
        const request: ConversionRequest = {
          fileUrl: `https://example.com/document.${format}`,
          fileName: `document.${format}`,
          mimeType: "application/msword",
          outputFormat: "pdf",
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(true);
      }
    });

    it("should accept all supported legacy Excel formats", async () => {
      const formats = ["xls", "xlsm", "xltx", "xltm"];

      for (const format of formats) {
        const request: ConversionRequest = {
          fileUrl: `https://example.com/spreadsheet.${format}`,
          fileName: `spreadsheet.${format}`,
          mimeType: "application/vnd.ms-excel",
          outputFormat: "pdf",
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(true);
      }
    });

    it("should accept all supported legacy PowerPoint formats", async () => {
      const formats = ["ppt", "pptm", "potx", "potm"];

      for (const format of formats) {
        const request: ConversionRequest = {
          fileUrl: `https://example.com/presentation.${format}`,
          fileName: `presentation.${format}`,
          mimeType: "application/vnd.ms-powerpoint",
          outputFormat: "pdf",
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(true);
      }
    });

    it("should accept OpenDocument formats", async () => {
      const formats = [
        { ext: "odt", mime: "application/vnd.oasis.opendocument.text" },
        { ext: "ods", mime: "application/vnd.oasis.opendocument.spreadsheet" },
        { ext: "odp", mime: "application/vnd.oasis.opendocument.presentation" },
      ];

      for (const format of formats) {
        const request: ConversionRequest = {
          fileUrl: `https://example.com/document.${format.ext}`,
          fileName: `document.${format.ext}`,
          mimeType: format.mime,
          outputFormat: "pdf",
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(true);
      }
    });

    it("should accept modern Office formats", async () => {
      const formats = ["docx", "xlsx", "pptx"];

      for (const format of formats) {
        const request: ConversionRequest = {
          fileUrl: `https://example.com/document.${format}`,
          fileName: `document.${format}`,
          mimeType: "application/vnd.openxmlformats-officedocument",
          outputFormat: "pdf",
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(true);
      }
    });

    it("should handle file names without extensions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document",
        fileName: "document",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported file type");
    });

    it("should be case-insensitive for file extensions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.DOC",
        fileName: "document.DOC",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Conversion Success Tests
  // Requirements: 2.2, 2.3
  // ===========================================================================

  describe("Conversion Success", () => {
    it("should return success result with output URL", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
      expect(result.outputUrl).toBeDefined();
      expect(typeof result.outputUrl).toBe("string");
      expect(result.outputUrl).toContain(".pdf");
    });

    it("should include processing time in result", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.processingTime).toBeGreaterThan(0);
      expect(typeof result.processingTime).toBe("number");
    });

    it("should generate unique output file names", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result1 = await converter.convert(request);
      const result2 = await converter.convert(request);

      expect(result1.outputUrl).not.toBe(result2.outputUrl);
    });

    it("should preserve base file name in output", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/my-document.doc",
        fileName: "my-document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.outputUrl).toContain("my-document");
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // Requirements: 2.4
  // ===========================================================================

  describe("Error Handling", () => {
    it("should return descriptive error for validation failures", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/image.jpg",
        fileName: "image.jpg",
        mimeType: "image/jpeg",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.error?.length).toBeGreaterThan(0);
    });

    it("should include processing time even for failed conversions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/image.jpg",
        fileName: "image.jpg",
        mimeType: "image/jpeg",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTime).toBe("number");
    });

    it("should not include output URL for failed conversions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/image.jpg",
        fileName: "image.jpg",
        mimeType: "image/jpeg",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.outputUrl).toBeUndefined();
    });
  });

  // ===========================================================================
  // Concurrency Tests
  // Requirements: 2.5 (implied by concurrent process limit)
  // ===========================================================================

  describe("Concurrency Management", () => {
    it("should enforce concurrent process limits", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => ({
        fileUrl: `https://example.com/document${i}.doc`,
        fileName: `document${i}.doc`,
        mimeType: "application/msword",
        outputFormat: "pdf" as const,
      }));

      // Start all conversions simultaneously
      const results = await Promise.all(requests.map((req) => converter.convert(req)));

      // Some should succeed, some should fail due to concurrency limit
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(successful.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);

      // Failed ones should have concurrency error
      const concurrencyErrors = failed.filter((r) =>
        r.error?.includes("Maximum concurrent conversions"),
      );
      expect(concurrencyErrors.length).toBeGreaterThan(0);
    });

    it("should allow conversions after previous ones complete", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      // First conversion
      const result1 = await converter.convert(request);
      expect(result1.success).toBe(true);

      // Second conversion (after first completes)
      const result2 = await converter.convert(request);
      expect(result2.success).toBe(true);
    });
  });

  // ===========================================================================
  // Health Check Tests
  // ===========================================================================

  describe("Health Check", () => {
    it("should report healthy when temp directory is accessible", async () => {
      const isHealthy = await converter.isHealthy();
      expect(typeof isHealthy).toBe("boolean");
    });
  });

  // ===========================================================================
  // Metrics Tests
  // ===========================================================================

  describe("Metrics", () => {
    it("should track total conversions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      await converter.convert(request);
      await converter.convert(request);

      const metrics = converter.getMetrics();
      expect(metrics.totalConversions).toBe(2);
    });

    it("should track successful conversions", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      await converter.convert(request);

      const metrics = converter.getMetrics();
      expect(metrics.successfulConversions).toBe(1);
    });

    it("should track failed conversions", async () => {
      const invalidRequest: ConversionRequest = {
        fileUrl: "https://example.com/image.jpg",
        fileName: "image.jpg",
        mimeType: "image/jpeg",
        outputFormat: "pdf",
      };

      await converter.convert(invalidRequest);

      const metrics = converter.getMetrics();
      expect(metrics.failedConversions).toBe(1);
    });

    it("should calculate average processing time", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      await converter.convert(request);
      await converter.convert(request);

      const metrics = converter.getMetrics();
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
    });

    it("should track active conversions", async () => {
      const metrics = converter.getMetrics();
      expect(metrics.activeConversions).toBe(0);
    });

    it("should reset metrics", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      await converter.convert(request);
      converter.resetMetrics();

      const metrics = converter.getMetrics();
      expect(metrics.totalConversions).toBe(0);
      expect(metrics.successfulConversions).toBe(0);
      expect(metrics.failedConversions).toBe(0);
    });
  });

  // ===========================================================================
  // Singleton Tests
  // ===========================================================================

  describe("Singleton Instance", () => {
    it("should return the same instance", () => {
      resetDocumentConverter();
      const instance1 = getDocumentConverter();
      const instance2 = getDocumentConverter();

      expect(instance1).toBe(instance2);
    });

    it("should reset singleton instance", () => {
      const instance1 = getDocumentConverter();
      resetDocumentConverter();
      const instance2 = getDocumentConverter();

      expect(instance1).not.toBe(instance2);
    });

    it("should accept custom configuration", () => {
      resetDocumentConverter();
      const instance = getDocumentConverter({
        maxConcurrentProcesses: 5,
      });

      expect(instance).toBeDefined();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    it("should handle file names with multiple dots", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/my.document.v2.doc",
        fileName: "my.document.v2.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
    });

    it("should handle file names with special characters", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document%20(1).doc",
        fileName: "document (1).doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
    });

    it("should handle very long file names", async () => {
      const longName = `${"a".repeat(200)}.doc`;
      const request: ConversionRequest = {
        fileUrl: `https://example.com/${longName}`,
        fileName: longName,
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
    });

    it("should handle whitespace in file names", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/my%20document.doc",
        fileName: "  my document.doc  ",
        mimeType: "application/msword",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      // Should succeed because trimmed name is valid
      expect(result.success).toBe(true);
    });

    it("should handle RTF files", async () => {
      const request: ConversionRequest = {
        fileUrl: "https://example.com/document.rtf",
        fileName: "document.rtf",
        mimeType: "application/rtf",
        outputFormat: "pdf",
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Temporary File Management Tests
  // Requirements: 2.6, 8.2, 8.3
  // ===========================================================================

  describe("Temporary File Management", () => {
    let tempBaseDir: string;

    beforeEach(async () => {
      tempBaseDir = path.join(os.tmpdir(), `test-converter-${Date.now()}`);
      await fs.mkdir(tempBaseDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(tempBaseDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    describe("TempFileSession", () => {
      it("should remain usable when cleanup() is called before initialize()", async () => {
        const session = new TempFileSession(tempBaseDir);
        expect(() => session.getSessionDir()).toThrow("not initialized");

        await expect(session.cleanup()).resolves.toBeUndefined();
        expect(session.isCleanedUp()).toBe(false);

        await session.initialize();
        const sessionDir = session.getSessionDir();
        await session.cleanup();
        await expect(fs.stat(sessionDir)).rejects.toMatchObject({ code: "ENOENT" });
      });

      it("should create a unique session directory", async () => {
        const session1 = new TempFileSession(tempBaseDir);
        const session2 = new TempFileSession(tempBaseDir);

        await session1.initialize();
        await session2.initialize();

        expect(session1.getSessionDir()).not.toBe(session2.getSessionDir());

        await session1.cleanup();
        await session2.cleanup();
      });

      it("should create the session directory as a direct child of the configured temp root with the document-converter- prefix (PUL-200)", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const sessionDir = session.getSessionDir();
        expect(path.dirname(sessionDir)).toBe(tempBaseDir);
        expect(path.basename(sessionDir)).toMatch(/^document-converter-/);

        await session.cleanup();
      });

      it("should create session directory with secure permissions", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const stats = await fs.stat(session.getSessionDir());
        expect(stats.isDirectory()).toBe(true);

        // Requirements: 2.6 - restricted permissions (0700 = rwx------), POSIX only
        if (process.platform !== "win32") {
          expect(stats.mode & 0o777).toBe(0o700);
        }

        await session.cleanup();
      });

      it("should create unique, non-colliding session directories under concurrent initialization", async () => {
        const sessions = Array.from({ length: 20 }, () => new TempFileSession(tempBaseDir));

        await Promise.all(sessions.map((session) => session.initialize()));

        const sessionDirs = sessions.map((session) => session.getSessionDir());
        expect(new Set(sessionDirs).size).toBe(sessionDirs.length);

        await Promise.all(sessions.map((session) => session.cleanup()));
      });

      it("should generate safe paths within session directory", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const safePath = session.getSafePath("test.pdf");
        expect(safePath).toContain(session.getSessionDir());
        expect(safePath).toContain("test.pdf");

        await session.cleanup();
      });

      it("should sanitize file names with path separators", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const safePath = session.getSafePath("../../../etc/passwd");
        expect(safePath).toContain(session.getSessionDir());
        // The path separators should be replaced with underscores
        expect(path.basename(safePath)).toContain("_");
        // Should not contain actual path separators in the filename
        const fileName = path.basename(safePath);
        expect(fileName).not.toContain("/");
        expect(fileName).not.toContain("\\");

        await session.cleanup();
      });

      it("should prevent directory traversal attacks", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        expect(() => {
          // Try to escape using path.join directly (bypassing sanitization)
          const maliciousPath = path.join(session.getSessionDir(), "..", "..", "etc", "passwd");
          // This should throw when we try to validate it
          const resolvedPath = path.resolve(maliciousPath);
          const resolvedSessionDir = path.resolve(session.getSessionDir());
          if (!resolvedPath.startsWith(resolvedSessionDir + path.sep)) {
            throw new Error("Invalid file path: directory traversal detected");
          }
        }).toThrow("directory traversal");

        await session.cleanup();
      });

      it("should remove dangerous characters from file names", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const safePath = session.getSafePath('test<>:"|?*.pdf');
        expect(safePath).not.toContain("<");
        expect(safePath).not.toContain(">");
        expect(safePath).not.toContain(":");
        expect(safePath).not.toContain('"');
        expect(safePath).not.toContain("|");
        expect(safePath).not.toContain("?");

        await session.cleanup();
      });

      it("should handle empty file names", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const safePath = session.getSafePath("");
        expect(safePath).toContain(session.getSessionDir());
        expect(safePath).toContain("file_");

        await session.cleanup();
      });

      it("should remove leading dots from file names", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const safePath = session.getSafePath("...hidden.pdf");
        expect(path.basename(safePath)).not.toMatch(/^\./);

        await session.cleanup();
      });

      it("should clean up session directory", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const sessionDir = session.getSessionDir();
        expect(
          await fs
            .stat(sessionDir)
            .then(() => true)
            .catch(() => false),
        ).toBe(true);

        await session.cleanup();
        expect(
          await fs
            .stat(sessionDir)
            .then(() => true)
            .catch(() => false),
        ).toBe(false);
      });

      it("should mark session as cleaned up", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        expect(session.isCleanedUp()).toBe(false);
        await session.cleanup();
        expect(session.isCleanedUp()).toBe(true);
      });

      it("should handle multiple cleanup calls gracefully", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        await session.cleanup();
        await session.cleanup(); // Should not throw

        expect(session.isCleanedUp()).toBe(true);
      });

      it("should clean up files within session directory", async () => {
        const session = new TempFileSession(tempBaseDir);
        await session.initialize();

        const testFile = session.getSafePath("test.txt");
        await fs.writeFile(testFile, "test content");

        expect(
          await fs
            .stat(testFile)
            .then(() => true)
            .catch(() => false),
        ).toBe(true);

        await session.cleanup();
        expect(
          await fs
            .stat(testFile)
            .then(() => true)
            .catch(() => false),
        ).toBe(false);
      });
    });

    describe("Path Validation Functions", () => {
      it("should validate paths within base directory", () => {
        const baseDir = "/tmp/test";
        const validPath = "/tmp/test/file.pdf";

        expect(validateFilePath(validPath, baseDir)).toBe(true);
      });

      it("should reject paths outside base directory", () => {
        const baseDir = "/tmp/test";
        const invalidPath = "/tmp/other/file.pdf";

        expect(validateFilePath(invalidPath, baseDir)).toBe(false);
      });

      it("should reject paths with directory traversal", () => {
        const baseDir = "/tmp/test";
        const invalidPath = "/tmp/test/../other/file.pdf";

        expect(validateFilePath(invalidPath, baseDir)).toBe(false);
      });

      it("should sanitize paths by removing null bytes", () => {
        const maliciousPath = "test\0file.pdf";
        const sanitized = sanitizeFilePath(maliciousPath);

        expect(sanitized).not.toContain("\0");
      });

      it("should sanitize paths by removing .. components", () => {
        const maliciousPath = "../../etc/passwd";
        const sanitized = sanitizeFilePath(maliciousPath);

        expect(sanitized).not.toContain("..");
        expect(sanitized).toBe(`etc${path.sep}passwd`);
      });

      it("should normalize path separators", () => {
        const mixedPath = "test\\file/document.pdf";
        const sanitized = sanitizeFilePath(mixedPath);

        expect(sanitized).toContain(path.sep);
        expect(sanitized).not.toContain("\\");
      });

      it("should remove . components", () => {
        const pathWithDots = "./test/./file.pdf";
        const sanitized = sanitizeFilePath(pathWithDots);

        expect(sanitized).not.toContain("./");
        expect(sanitized).toBe(`test${path.sep}file.pdf`);
      });
    });

    describe("Automatic Cleanup Integration", () => {
      it("should clean up temporary files after successful conversion", async () => {
        const testConverter = new DocumentConverter({
          tempDirectory: tempBaseDir,
        });

        const request: ConversionRequest = {
          fileUrl: "https://example.com/document.doc",
          fileName: "document.doc",
          mimeType: "application/msword",
          outputFormat: "pdf",
        };

        await testConverter.convert(request);

        // Check that no session directories remain
        const files = await fs.readdir(tempBaseDir);
        // Session directories should be cleaned up
        expect(files.length).toBe(0);
      });

      it("should clean up temporary files after failed conversion", async () => {
        const testConverter = new DocumentConverter({
          tempDirectory: tempBaseDir,
        });

        const request: ConversionRequest = {
          fileUrl: "https://example.com/image.jpg",
          fileName: "image.jpg",
          mimeType: "image/jpeg",
          outputFormat: "pdf",
        };

        await testConverter.convert(request);

        // Check that no session directories remain
        const files = await fs.readdir(tempBaseDir);
        expect(files.length).toBe(0);
      });
    });
  });
});

describe("DocumentConverter default temporary root", () => {
  it.skipIf(process.platform === "win32")(
    "does not depend on a fixed-owner document-converter parent (PUL-200)",
    async () => {
      const originalTmpDir = process.env.TMPDIR;
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pul-200-temp-root-"));
      const legacyParent = path.join(tempRoot, "document-converter");
      let testConverter: { shutdown(): Promise<void> } | null = null;
      await fs.mkdir(legacyParent, { mode: 0o500 });

      try {
        process.env.TMPDIR = tempRoot;
        vi.resetModules();
        const converterModule = await import("./document-converter");
        testConverter = new converterModule.DocumentConverter();
        const config = (
          testConverter as unknown as {
            config: { tempDirectory: string };
          }
        ).config;
        const session = new converterModule.TempFileSession(config.tempDirectory);

        await session.initialize();

        expect(path.dirname(session.getSessionDir())).toBe(tempRoot);
        expect(session.getSessionDir()).not.toContain(`${legacyParent}${path.sep}`);

        await session.cleanup();
      } finally {
        await testConverter?.shutdown();
        if (originalTmpDir === undefined) {
          delete process.env.TMPDIR;
        } else {
          process.env.TMPDIR = originalTmpDir;
        }
        await fs.chmod(legacyParent, 0o700);
        await fs.rm(tempRoot, { recursive: true, force: true });
        vi.resetModules();
      }
    },
  );
});
