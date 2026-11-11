/**
 * Tests for LibreOffice Utilities
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getLibreOfficeConversionArgs } from "./libreoffice-utils";

describe("LibreOffice Utilities", () => {
  beforeEach(() => {
    delete process.env.LIBREOFFICE_PATH;
    delete process.env.LIBREOFFICE;
  });

  describe("getLibreOfficeConversionArgs", () => {
    it("should return correct arguments for PDF conversion", () => {
      const args = getLibreOfficeConversionArgs("/input/file.docx", "/output", "pdf");

      expect(args).toEqual([
        "--headless",
        "--invisible",
        "--nodefault",
        "--nolockcheck",
        "--nologo",
        "--norestore",
        "--nofirststartwizard",
        "--convert-to",
        "pdf",
        "--outdir",
        "/output",
        "/input/file.docx",
      ]);
    });

    it("should return correct arguments for HTML conversion", () => {
      const args = getLibreOfficeConversionArgs("/input/file.docx", "/output", "html");

      expect(args).toEqual([
        "--headless",
        "--invisible",
        "--nodefault",
        "--nolockcheck",
        "--nologo",
        "--norestore",
        "--nofirststartwizard",
        "--convert-to",
        "html",
        "--outdir",
        "/output",
        "/input/file.docx",
      ]);
    });

    it("should default to PDF if format not specified", () => {
      const args = getLibreOfficeConversionArgs("/input/file.docx", "/output");

      expect(args).toContain("pdf");
    });
  });
});
