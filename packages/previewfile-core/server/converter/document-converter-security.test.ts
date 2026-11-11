/**
 * Document Converter Security Tests
 *
 * Tests for security validation features including file size limits,
 * input validation, and security scanning.
 *
 * Requirements: 8.4, 8.6
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DocumentConverter,
  resetDocumentConverter,
  validateConversionRequest,
} from "./document-converter";

describe("DocumentConverter Security Features", () => {
  let converter: DocumentConverter;
  let testDir: string;

  beforeEach(async () => {
    resetDocumentConverter();
    testDir = path.join(os.tmpdir(), `test-security-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    converter = new DocumentConverter({
      maxConcurrentProcesses: 2,
      conversionTimeout: 5000,
      maxFileSize: 1024 * 1024, // 1MB for testing
      tempDirectory: testDir,
    });
  });

  afterEach(async () => {
    await converter.shutdown();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("File Size Validation", () => {
    it("should reject file names that are too long", async () => {
      const longFileName = `${"a".repeat(300)}.doc`;
      const request = {
        fileUrl: "https://example.com/document.doc",
        fileName: longFileName,
        mimeType: "application/msword",
        outputFormat: "pdf" as const,
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("File name is too long");
    });

    it("should reject URLs that are too long", async () => {
      const longUrl = `https://example.com/${"a".repeat(2100)}/document.doc`;
      const request = {
        fileUrl: longUrl,
        fileName: "document.doc",
        mimeType: "application/msword",
        outputFormat: "pdf" as const,
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("File URL is too long");
    });

    it("should validate file size when file exists", async () => {
      // Create a test file
      const testFile = path.join(testDir, "test.pdf");
      await fs.writeFile(testFile, Buffer.alloc(100));

      const sizeValidation = await converter.validateFileSize(testFile);
      expect(sizeValidation.valid).toBe(true);
      expect(sizeValidation.size).toBe(100);
    });

    it("should reject files that are too small", async () => {
      // Create a very small file
      const testFile = path.join(testDir, "tiny.pdf");
      await fs.writeFile(testFile, Buffer.alloc(5));

      const sizeValidation = await converter.validateFileSize(testFile);
      expect(sizeValidation.valid).toBe(false);
      expect(sizeValidation.error).toContain("too small");
    });

    it("should reject files that exceed max size", async () => {
      // Create a file larger than max size (1MB)
      const testFile = path.join(testDir, "large.pdf");
      await fs.writeFile(testFile, Buffer.alloc(2 * 1024 * 1024)); // 2MB

      const sizeValidation = await converter.validateFileSize(testFile);
      expect(sizeValidation.valid).toBe(false);
      expect(sizeValidation.error).toContain("exceeds maximum");
    });
  });

  describe("Input Validation", () => {
    it("should reject file names with null bytes", async () => {
      const request = {
        fileUrl: "https://example.com/document.doc",
        fileName: "document\0.doc",
        mimeType: "application/msword",
        outputFormat: "pdf" as const,
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      expect(result.error).toContain("suspicious patterns");
    });

    it("should reject file names with path traversal attempts", async () => {
      const pathTraversalNames = [
        "../../../etc/passwd.doc",
        "..\\..\\windows\\system32.doc",
        "document/../secret.doc",
      ];

      for (const fileName of pathTraversalNames) {
        const request = {
          fileUrl: "https://example.com/document.doc",
          fileName,
          mimeType: "application/msword",
          outputFormat: "pdf" as const,
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(false);
        expect(result.error).toContain("suspicious patterns");
      }
    });

    it("should accept file names with CJK characters", () => {
      const cjkFileNames = [
        "维格入职邀请函.doc",
        "日本語ファイル.doc",
        "한국어파일.doc",
        "vika维格入职邀请函-奥特曼.doc",
      ];

      for (const fileName of cjkFileNames) {
        const request = {
          fileUrl: "https://example.com/document.doc",
          fileName,
          mimeType: "application/msword",
          outputFormat: "pdf" as const,
        };

        expect(validateConversionRequest(request)).toBeNull();
      }
    });

    it("should reject file names with script injection patterns", async () => {
      const scriptPatterns = [
        "<script>alert('xss')</script>.doc",
        "javascript:alert('xss').doc",
        "onerror=alert('xss').doc",
      ];

      for (const fileName of scriptPatterns) {
        const request = {
          fileUrl: "https://example.com/document.doc",
          fileName,
          mimeType: "application/msword",
          outputFormat: "pdf" as const,
        };

        const result = await converter.convert(request);
        expect(result.success).toBe(false);
        expect(result.error).toContain("suspicious patterns");
      }
    });

    it("should accept normal file names", () => {
      const normalFileNames = [
        "document.doc",
        "my-document.doc",
        "report_2024.doc",
        "file (1).doc",
      ];

      for (const fileName of normalFileNames) {
        const request = {
          fileUrl: "https://example.com/document.doc",
          fileName,
          mimeType: "application/msword",
          outputFormat: "pdf" as const,
        };

        expect(validateConversionRequest(request)).toBeNull();
      }
    });
  });

  describe("PDF Security Scanning", () => {
    it("should detect invalid PDF header", async () => {
      // Create a file with invalid PDF header
      const testFile = path.join(testDir, "invalid.pdf");
      await fs.writeFile(testFile, "Not a PDF file");

      // Use private method through type assertion for testing
      const scanResult = await (converter as any).scanPdfContent(testFile);
      expect(scanResult.safe).toBe(false);
      expect(scanResult.reason).toContain("Invalid PDF header");
    });

    it("should detect JavaScript in PDF", async () => {
      // Create a PDF-like file with JavaScript
      const testFile = path.join(testDir, "malicious.pdf");
      const content = "%PDF-1.4\n/JS (alert('xss'))";
      await fs.writeFile(testFile, content);

      const scanResult = await (converter as any).scanPdfContent(testFile);
      expect(scanResult.safe).toBe(false);
      expect(scanResult.reason).toContain("JavaScript");
    });

    it("should detect embedded files in PDF", async () => {
      // Create a PDF-like file with embedded files
      const testFile = path.join(testDir, "embedded.pdf");
      const content = "%PDF-1.4\n/EmbeddedFile /Type /Filespec";
      await fs.writeFile(testFile, content);

      const scanResult = await (converter as any).scanPdfContent(testFile);
      expect(scanResult.safe).toBe(false);
      expect(scanResult.reason).toContain("embedded files");
    });

    it("should accept clean PDF", async () => {
      // Create a minimal valid PDF
      const testFile = path.join(testDir, "clean.pdf");
      const content = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj";
      await fs.writeFile(testFile, content);

      const scanResult = await (converter as any).scanPdfContent(testFile);
      expect(scanResult.safe).toBe(true);
    });
  });

  describe("Comprehensive Security", () => {
    it.skipIf(process.env.VITEST_SKIP_LIBREOFFICE_INTEGRATION === "true")(
      "should validate all security aspects of a request",
      async () => {
        const request = {
          fileUrl: "https://example.com/document.doc",
          fileName: "normal-document.doc",
          mimeType: "application/msword",
          outputFormat: "pdf" as const,
        };

        const result = await converter.convert(request);
        // Should pass all validation checks
        // Note: Will succeed because placeholder doesn't create actual file
        expect(result.success).toBe(true);
      },
    );

    it("should handle multiple validation failures gracefully", async () => {
      const request = {
        fileUrl: `https://example.com/${"a".repeat(2100)}`,
        fileName: `${"a".repeat(300)}.doc`,
        mimeType: "application/msword",
        outputFormat: "pdf" as const,
      };

      const result = await converter.convert(request);
      expect(result.success).toBe(false);
      // Should fail on first validation error
      expect(result.error).toBeDefined();
    });
  });
});
