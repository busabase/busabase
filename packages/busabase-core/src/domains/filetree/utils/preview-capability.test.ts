import { describe, expect, it } from "vitest";
import { isBuiltinDrivePreviewSufficient, shouldEscalateDrivePreview } from "./preview-capability";

describe("shouldEscalateDrivePreview", () => {
  it.each([
    ["Markdown", "notes/README.md", "text/markdown"],
    ["source text", "src/index.ts", "text/plain"],
    // The backend labels every text-shaped upload `text/plain`, so an SVG only
    // reads as an image once the extension is taken into account.
    ["SVG stored as text", "logo.svg", "text/plain"],
    ["PNG", "shots/logo.png", "image/png"],
    ["PDF", "report.pdf", "application/pdf"],
    ["MP4", "clip.mp4", "video/mp4"],
    ["MP3", "voice.mp3", "audio/mpeg"],
    ["CSV", "reference/team-roster.csv", "text/csv"],
    ["JSON", "config.json", "application/json"],
  ])("keeps %s on the built-in preview", (_label, path, mimeType) => {
    expect(shouldEscalateDrivePreview({ path, mimeType })).toBe(false);
    expect(isBuiltinDrivePreviewSufficient({ path, mimeType })).toBe(true);
  });

  it.each([
    [
      "DOCX",
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["XLSX", "sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [
      "PPTX",
      "deck.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["legacy DOC", "old.doc", "application/msword"],
    ["ODT", "notes.odt", "application/vnd.oasis.opendocument.text"],
    ["EPUB", "book.epub", "application/epub+zip"],
    ["PSD", "cover.psd", "image/vnd.adobe.photoshop"],
    ["TIFF", "scan.tiff", "image/tiff"],
    ["ZIP", "bundle.zip", "application/zip"],
    ["7z", "archive.7z", "application/x-7z-compressed"],
  ])("escalates %s to the configured provider", (_label, path, mimeType) => {
    expect(shouldEscalateDrivePreview({ path, mimeType })).toBe(true);
    expect(isBuiltinDrivePreviewSufficient({ path, mimeType })).toBe(false);
  });

  it("escalates an Office file whose upload lost its MIME type", () => {
    // Uploads routinely arrive as octet-stream; the extension has to carry it.
    expect(
      shouldEscalateDrivePreview({
        path: "brief.docx",
        mimeType: "application/octet-stream",
      }),
    ).toBe(true);
  });

  it("escalates OOXML even though Busabase stores it as a text asset", () => {
    // `contentKindForMimeType` matches on `mimeType.includes("xml")`, so every
    // `…openxmlformats-officedocument…` file is stored with contentKind "text".
    // Routing on that signal kept DOCX local and broke the whole feature; this
    // test pins the decision to the format instead.
    expect(
      shouldEscalateDrivePreview({
        path: "quarterly-brief.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
  });

  it("leaves an unknown binary on the built-in preview rather than guessing", () => {
    // Unrecognized means "stays in this deployment": a missing entry costs a
    // download-link experience, never an unintended upload.
    expect(
      shouldEscalateDrivePreview({ path: "firmware.bin", mimeType: "application/octet-stream" }),
    ).toBe(false);
  });
});
