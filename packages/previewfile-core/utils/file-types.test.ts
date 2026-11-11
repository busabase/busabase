import { describe, expect, it } from "vitest";
import { SUPPORTED_EXTENSIONS } from "../server/converter/document-converter";
import {
  canPreview,
  detectFileType,
  FileType,
  isDocx,
  mimeTypeForFileName,
  needsConverter,
} from "./file-types";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("detectFileType", () => {
  it.each([
    ["report.pdf", "", FileType.PDF],
    ["photo.png", "", FileType.IMAGE],
    ["photo.JPG", "", FileType.IMAGE],
    ["icon.svg", "", FileType.IMAGE],
    ["scan.tiff", "", FileType.TIFF],
    ["scan.tif", "image/tiff", FileType.TIFF],
    ["layers.psd", "application/octet-stream", FileType.PSD],
    ["clip.mp4", "", FileType.VIDEO],
    ["clip.mkv", "", FileType.VIDEO],
    ["clip.ogv", "", FileType.VIDEO],
    ["clip.ogg", "video/ogg", FileType.VIDEO],
    ["memo.ogg", "audio/ogg", FileType.AUDIO],
    ["memo.mp3", "", FileType.AUDIO],
    ["memo.opus", "", FileType.AUDIO],
    ["voice.silk", "", FileType.SILK_AUDIO],
    ["voice.slk", "application/octet-stream", FileType.SILK_AUDIO],
    ["captions.srt", "", FileType.SUBTITLE],
    ["captions.vtt", "", FileType.SUBTITLE],
    // The subtitle viewer parses SRT/VTT only; the rest read fine as text.
    ["captions.ass", "", FileType.TEXT],
    ["sheet.xlsx", "", FileType.SPREADSHEET],
    ["legacy.XLS", "", FileType.SPREADSHEET],
    ["budget.ods", "", FileType.SPREADSHEET],
    ["macro.xlsm", "", FileType.SPREADSHEET],
    ["export.csv", "", FileType.SPREADSHEET],
    ["export.tsv", "", FileType.SPREADSHEET],
    ["文档-2023年.xlsx", "", FileType.SPREADSHEET],
    ["proposal.docx", "", FileType.WORD],
    ["old.doc", "", FileType.WORD],
    ["notes.odt", "", FileType.WORD],
    ["letter.rtf", "", FileType.WORD],
    ["essay.pages", "", FileType.WORD],
    ["deck.pptx", "", FileType.PRESENTATION],
    ["deck.ppt", "", FileType.PRESENTATION],
    ["talk.key", "", FileType.PRESENTATION],
    ["slides.odp", "", FileType.PRESENTATION],
    ["README.md", "", FileType.MARKDOWN],
    ["notes.markdown", "", FileType.MARKDOWN],
    ["config.json", "", FileType.CODE],
    ["main.py", "", FileType.CODE],
    // An extension decides before the MIME type: .ts is TypeScript, not MPEG-TS.
    ["index.ts", "video/mp2t", FileType.CODE],
    ["notes.txt", "", FileType.TEXT],
    ["server.log", "", FileType.TEXT],
    ["book.epub", "", FileType.EPUB],
    ["bundle.zip", "", FileType.ARCHIVE],
    ["backup.tar.gz", "", FileType.ARCHIVE],
    ["assets.7z", "", FileType.ARCHIVE],
    ["lib.jar", "", FileType.ARCHIVE],
    ["crm-export.sqlite", "", FileType.SQLITE],
    ["app.db3", "", FileType.SQLITE],
    ["part.stl", "", FileType.MODEL_3D],
    ["scene.glb", "", FileType.MODEL_3D],
    // Formats with no viewer.
    ["scene.fbx", "", FileType.UNSUPPORTED],
    ["plan.dwg", "", FileType.UNSUPPORTED],
    ["flow.drawio", "", FileType.UNSUPPORTED],
    ["file.unknown", "application/unknown", FileType.UNSUPPORTED],
  ])("%s (%s) → %s", (fileName, mimeType, expected) => {
    expect(detectFileType({ fileName, mimeType })).toBe(expected);
  });

  it.each([
    ["Agency follow-up", XLSX, FileType.SPREADSHEET],
    ["Quarterly report", "application/pdf", FileType.PDF],
    ["Kickoff", PPTX, FileType.PRESENTATION],
    ["Contract", DOCX, FileType.WORD],
    ["export", "text/csv; charset=utf-8", FileType.SPREADSHEET],
    ["README", "text/plain", FileType.TEXT],
    ["notes", "text/x-python", FileType.TEXT],
    ["portrait", "image/heic", FileType.IMAGE],
    ["scan", "image/tiff", FileType.TIFF],
    ["clip", "video/x-flv", FileType.VIDEO],
    ["memo", "audio/ogg", FileType.AUDIO],
    ["voice", "audio/silk", FileType.SILK_AUDIO],
    ["archive", "application/x-zip-compressed", FileType.ARCHIVE],
    ["data", "application/x-sqlite3", FileType.SQLITE],
  ])("falls back to the MIME type for %s (%s)", (fileName, mimeType, expected) => {
    expect(detectFileType({ fileName, mimeType })).toBe(expected);
  });

  it("knows nothing about a file with neither a known extension nor a MIME type", () => {
    expect(detectFileType({ fileName: "unknown", mimeType: "application/octet-stream" })).toBe(
      FileType.UNSUPPORTED,
    );
    expect(detectFileType({ fileName: "unknown.bin", mimeType: "" })).toBe(FileType.UNSUPPORTED);
    expect(detectFileType({ fileName: "", mimeType: null })).toBe(FileType.UNSUPPORTED);
  });

  it("lets the extension win over a MIME type that disagrees", () => {
    expect(detectFileType({ fileName: "document.txt", mimeType: "application/pdf" })).toBe(
      FileType.TEXT,
    );
  });
});

describe("needsConverter", () => {
  it.each([
    ["deck.pptx", true],
    ["old.doc", true],
    ["notes.odt", true],
    // Every host draws a .docx in the browser.
    ["proposal.docx", false],
    ["sheet.xlsx", false],
    ["report.pdf", false],
  ])("%s → %s", (fileName, expected) => {
    expect(needsConverter({ fileName })).toBe(expected);
  });

  it("recognises a .docx by MIME type when the name has no extension", () => {
    expect(isDocx({ fileName: "Contract", mimeType: DOCX })).toBe(true);
    expect(needsConverter({ fileName: "Contract", mimeType: DOCX })).toBe(false);
  });

  it("only routes extensions the server converter accepts to it", () => {
    const routed = (
      "doc docm dot dotx dotm odt ott fodt rtf wpd wps pages lwp " +
      "ppt pptx pptm pot potx potm pps ppsx ppsm odp otp fodp key kth"
    ).split(" ");
    for (const ext of routed) {
      expect(needsConverter({ fileName: `file.${ext}` })).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(ext), ext).toBe(true);
    }
    // A .docx that fails to draw falls back to the converter, so it must accept it too.
    expect(SUPPORTED_EXTENSIONS.has("docx")).toBe(true);
  });
});

describe("canPreview", () => {
  const hosted = { officeConversion: true };
  const selfHosted = { officeConversion: false };

  it("needs a converter for Office formats only the server renders", () => {
    expect(canPreview({ fileName: "deck.pptx" }, hosted)).toBe(true);
    expect(canPreview({ fileName: "deck.pptx" }, selfHosted)).toBe(false);
    expect(canPreview({ fileName: "proposal.docx" }, selfHosted)).toBe(true);
  });

  it("needs an extension for the converter to pick LibreOffice's import filter by", () => {
    expect(canPreview({ fileName: "Kickoff", mimeType: PPTX }, hosted)).toBe(false);
  });

  it("has no viewer for unknown files in an embed", () => {
    expect(canPreview({ fileName: "plan.dwg" }, hosted)).toBe(false);
    expect(canPreview({ fileName: "plan.dwg" }, { ...hosted, model3d: true })).toBe(false);
  });

  it("previews 3D models only for a host that mounts the 3D viewer", () => {
    for (const fileName of ["part.stl", "scene.obj", "robot.gltf", "robot.glb"]) {
      expect(canPreview({ fileName }, hosted), fileName).toBe(false);
      expect(canPreview({ fileName }, { ...hosted, model3d: true }), fileName).toBe(true);
    }
  });
});

describe("mimeTypeForFileName", () => {
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["deck.pptx", PPTX],
    ["sheet.xlsx", XLSX],
    ["drawing.odg", "application/vnd.oasis.opendocument.graphics"],
    ["voice.silk", "audio/silk"],
    ["data.json", "application/json"],
  ])("%s → %s", (fileName, expected) => {
    expect(mimeTypeForFileName(fileName)).toBe(expected);
  });

  it("never labels an upload with a type a browser would execute", () => {
    for (const fileName of ["page.html", "page.htm", "logo.svg", "app.js", "app.mjs"]) {
      expect(mimeTypeForFileName(fileName), fileName).toBe("text/plain");
    }
  });

  it("returns null when the extension says nothing", () => {
    expect(mimeTypeForFileName("README")).toBeNull();
    expect(mimeTypeForFileName("blob.bin")).toBeNull();
  });
});
