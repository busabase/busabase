/**
 * File Validation Utilities Tests
 */

import { describe, expect, it } from "vitest";
import {
  isDocumentFile,
  isImageFile,
  validateFile,
  validateFileExtension,
  validateFileSize,
  validateFileType,
} from "./file-validation";

describe("validateFileSize", () => {
  it("should accept files within size limit", () => {
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    const result = validateFileSize(file, 1024 * 1024); // 1MB
    expect(result.isValid).toBe(true);
  });

  it("should reject files exceeding size limit", () => {
    const file = new File(["x".repeat(2 * 1024 * 1024)], "test.pdf", { type: "application/pdf" });
    const result = validateFileSize(file, 1024 * 1024); // 1MB
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("File size exceeds maximum allowed size");
  });

  it("should handle default max size", () => {
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    const result = validateFileSize(file);
    expect(result.isValid).toBe(true);
  });
});

describe("validateFileType", () => {
  it("should accept allowed file types", () => {
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    const result = validateFileType(file, ["application/pdf", "image/jpeg"]);
    expect(result.isValid).toBe(true);
  });

  it("should reject disallowed file types", () => {
    const file = new File(["content"], "test.exe", { type: "application/exe" });
    const result = validateFileType(file, ["application/pdf", "image/jpeg"]);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("is not supported");
  });

  it("should allow files without type", () => {
    const file = new File(["content"], "test.unknown");
    const result = validateFileType(file, ["application/pdf"]);
    expect(result.isValid).toBe(true);
  });

  it("should accept all types when allowedTypes is empty", () => {
    const file = new File(["content"], "test.exe", { type: "application/exe" });
    const result = validateFileType(file, []);
    expect(result.isValid).toBe(true);
  });
});

describe("validateFileExtension", () => {
  it("should accept allowed extensions", () => {
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    const result = validateFileExtension(file, [".pdf", ".docx"]);
    expect(result.isValid).toBe(true);
  });

  it("should reject disallowed extensions", () => {
    const file = new File(["content"], "test.exe", { type: "application/exe" });
    const result = validateFileExtension(file, [".pdf", ".docx"]);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("is not supported");
  });

  it("should handle case insensitive extension matching", () => {
    const file = new File(["content"], "test.PDF", { type: "application/pdf" });
    const result = validateFileExtension(file, [".pdf"]);
    expect(result.isValid).toBe(true);
  });

  it("should accept all extensions when allowedExtensions is empty", () => {
    const file = new File(["content"], "test.unknown");
    const result = validateFileExtension(file, []);
    expect(result.isValid).toBe(true);
  });
});

describe("validateFile", () => {
  it("should validate file successfully with all checks", () => {
    const file = new File(["content"], "test.pdf", { type: "application/pdf" });
    const result = validateFile(file);
    expect(result.isValid).toBe(true);
  });

  it("should return error when size is too large", () => {
    const file = new File(["x".repeat(100 * 1024 * 1024)], "test.pdf", { type: "application/pdf" });
    const result = validateFile(file, { maxSizeBytes: 1024 * 1024 });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("File size");
  });

  it("should return error when type is not allowed", () => {
    const file = new File(["content"], "test.exe", { type: "application/exe" });
    const result = validateFile(file, { allowedTypes: ["application/pdf"] });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("type");
  });

  it("should return error when extension is not allowed", () => {
    const file = new File(["content"], "test.exe", { type: "application/pdf" });
    const result = validateFile(file, { allowedExtensions: [".pdf"] });
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("extension");
  });

  it("should use custom validation options", () => {
    const file = new File(["content"], "test.custom", { type: "application/custom" });
    const result = validateFile(file, {
      maxSizeBytes: 1024 * 1024,
      allowedTypes: ["application/custom"],
      allowedExtensions: [".custom"],
    });
    expect(result.isValid).toBe(true);
  });
});

describe("isImageFile", () => {
  it("should identify image files", () => {
    const jpegFile = new File(["content"], "test.jpg", { type: "image/jpeg" });
    const pngFile = new File(["content"], "test.png", { type: "image/png" });

    expect(isImageFile(jpegFile)).toBe(true);
    expect(isImageFile(pngFile)).toBe(true);
  });

  it("should reject non-image files", () => {
    const pdfFile = new File(["content"], "test.pdf", { type: "application/pdf" });
    expect(isImageFile(pdfFile)).toBe(false);
  });
});

describe("isDocumentFile", () => {
  it("should identify document files", () => {
    const pdfFile = new File(["content"], "test.pdf", { type: "application/pdf" });
    const docFile = new File(["content"], "test.doc", { type: "application/msword" });
    const textFile = new File(["content"], "test.txt", { type: "text/plain" });

    expect(isDocumentFile(pdfFile)).toBe(true);
    expect(isDocumentFile(docFile)).toBe(true);
    expect(isDocumentFile(textFile)).toBe(true);
  });

  it("should reject non-document files", () => {
    const imageFile = new File(["content"], "test.jpg", { type: "image/jpeg" });
    expect(isDocumentFile(imageFile)).toBe(false);
  });
});
