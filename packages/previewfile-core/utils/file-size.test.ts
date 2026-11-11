/**
 * Unit tests for file size formatting utilities
 */

import { describe, expect, it } from "vitest";
import { formatFileSize, formatFileSizeString } from "./file-size";

describe("File Size Formatting", () => {
  describe("formatFileSize()", () => {
    it("should handle zero bytes", () => {
      const result = formatFileSize(0);
      expect(result).toEqual({
        value: 0,
        unit: "B",
        formatted: "0 B",
      });
    });

    it("should handle negative values by treating as zero", () => {
      const result = formatFileSize(-100);
      expect(result).toEqual({
        value: 0,
        unit: "B",
        formatted: "0 B",
      });
    });

    it("should handle invalid inputs (NaN, Infinity)", () => {
      expect(formatFileSize(NaN)).toEqual({
        value: 0,
        unit: "B",
        formatted: "0 B",
      });

      expect(formatFileSize(Infinity)).toEqual({
        value: 0,
        unit: "B",
        formatted: "0 B",
      });

      expect(formatFileSize(-Infinity)).toEqual({
        value: 0,
        unit: "B",
        formatted: "0 B",
      });
    });

    it("should format bytes correctly (less than 1024)", () => {
      expect(formatFileSize(1)).toEqual({
        value: 1,
        unit: "B",
        formatted: "1 B",
      });

      expect(formatFileSize(512)).toEqual({
        value: 512,
        unit: "B",
        formatted: "512 B",
      });

      expect(formatFileSize(1023)).toEqual({
        value: 1023,
        unit: "B",
        formatted: "1023 B",
      });
    });

    it("should format kilobytes correctly", () => {
      expect(formatFileSize(1024)).toEqual({
        value: 1,
        unit: "KB",
        formatted: "1 KB",
      });

      expect(formatFileSize(1536)).toEqual({
        value: 1.5,
        unit: "KB",
        formatted: "1.5 KB",
      });

      expect(formatFileSize(1024 * 1023)).toEqual({
        value: 1023,
        unit: "KB",
        formatted: "1023 KB",
      });
    });

    it("should format megabytes correctly", () => {
      expect(formatFileSize(1024 * 1024)).toEqual({
        value: 1,
        unit: "MB",
        formatted: "1 MB",
      });

      expect(formatFileSize(1024 * 1024 * 1.25)).toEqual({
        value: 1.25,
        unit: "MB",
        formatted: "1.25 MB",
      });
    });

    it("should format gigabytes correctly", () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toEqual({
        value: 1,
        unit: "GB",
        formatted: "1 GB",
      });

      expect(formatFileSize(1024 * 1024 * 1024 * 2.5)).toEqual({
        value: 2.5,
        unit: "GB",
        formatted: "2.5 GB",
      });
    });

    it("should format terabytes correctly", () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toEqual({
        value: 1,
        unit: "TB",
        formatted: "1 TB",
      });

      expect(formatFileSize(1024 * 1024 * 1024 * 1024 * 1.5)).toEqual({
        value: 1.5,
        unit: "TB",
        formatted: "1.5 TB",
      });
    });

    it("should handle very large values (stay at TB)", () => {
      const veryLarge = 1024 * 1024 * 1024 * 1024 * 1024; // 1 PB in bytes
      const result = formatFileSize(veryLarge);
      expect(result.unit).toBe("TB");
      expect(result.value).toBe(1024);
      expect(result.formatted).toBe("1024 TB");
    });

    it("should round to 2 decimal places for non-byte units", () => {
      // Test a value that would have more than 2 decimal places
      const bytes = 1024 * 1.23456789;
      const result = formatFileSize(bytes);
      expect(result.value).toBe(1.23);
      expect(result.formatted).toBe("1.23 KB");
    });

    it("should use integer values for bytes", () => {
      const result = formatFileSize(512.7);
      expect(result.value).toBe(512);
      expect(result.formatted).toBe("512 B");
    });
  });

  describe("formatFileSizeString()", () => {
    it("should return just the formatted string", () => {
      expect(formatFileSizeString(0)).toBe("0 B");
      expect(formatFileSizeString(1024)).toBe("1 KB");
      expect(formatFileSizeString(1024 * 1024)).toBe("1 MB");
      expect(formatFileSizeString(1536)).toBe("1.5 KB");
    });
  });

  describe("Edge cases and requirements compliance", () => {
    it("should use 1024-based calculations (binary prefixes)", () => {
      // 1 KB should be exactly 1024 bytes, not 1000
      expect(formatFileSize(1024).unit).toBe("KB");
      expect(formatFileSize(1023).unit).toBe("B");

      // 1 MB should be 1024 * 1024 bytes
      expect(formatFileSize(1024 * 1024).unit).toBe("MB");
      expect(formatFileSize(1024 * 1024 - 1).unit).toBe("KB");
    });

    it("should support all required units", () => {
      const _units = ["B", "KB", "MB", "GB", "TB"];

      expect(formatFileSize(1).unit).toBe("B");
      expect(formatFileSize(1024).unit).toBe("KB");
      expect(formatFileSize(1024 * 1024).unit).toBe("MB");
      expect(formatFileSize(1024 * 1024 * 1024).unit).toBe("GB");
      expect(formatFileSize(1024 * 1024 * 1024 * 1024).unit).toBe("TB");
    });

    it("should display up to 2 decimal places for clarity", () => {
      // Test various decimal scenarios
      expect(formatFileSize(1024 * 1.1).formatted).toBe("1.1 KB");
      expect(formatFileSize(1024 * 1.12).formatted).toBe("1.12 KB");
      expect(formatFileSize(1024 * 1.123).formatted).toBe("1.12 KB"); // Rounded to 2 decimals
      expect(formatFileSize(1024 * 1.999).formatted).toBe("2 KB"); // Rounded up
    });
  });
});
