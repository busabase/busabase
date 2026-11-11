import { describe, expect, it } from "vitest";
import { attachmentFileType } from "./attachment-file-type";

describe("attachmentFileType", () => {
  it.each([
    ["REPORT.XLSX", "application/octet-stream", "spreadsheet", "XLSX"],
    ["data.csv", "text/plain", "spreadsheet", "CSV"],
    ["brief.docx", "", "document", "DOCX"],
    ["slides.odp", "", "presentation", "ODP"],
    ["payload.json", "text/plain", "json", "JSON"],
    ["events.jsonl", "application/octet-stream", "json", "JSONL"],
    ["readme.MD", "text/plain; charset=utf-8", "markdown", "MD"],
    ["guide.markdown", "", "markdown", "MD"],
    ["widget.tsx", "", "code", "TSX"],
    ["settings.yaml", "", "config", "YAML"],
    [".env", "", "config", "ENV"],
    ["archive.7z", "", "archive", "7Z"],
    ["report.pdf", "", "pdf", "PDF"],
    ["song.flac", "", "audio", "FLAC"],
    ["clip.webm", "", "video", "WEBM"],
    ["photo.HEIC", "", "image", "HEIC"],
    ["notes.txt", "", "text", "TXT"],
    ["unknown.bin", "application/octet-stream", "file", "BIN"],
    ["README", "", "file", "FILE"],
    ["notes.", "text/plain", "text", "TXT"],
  ])("identifies %s even with generic upload MIME metadata", (name, mime, kind, label) => {
    expect(attachmentFileType(name, mime)).toEqual({ kind, label });
  });

  it.each([
    ["Application/PDF; charset=binary", "pdf"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheet"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "presentation"],
    ["application/vnd.api+json", "json"],
    ["application/atom+xml", "config"],
    ["text/markdown", "markdown"],
    ["application/zip", "archive"],
    ["audio/ogg", "audio"],
    ["video/mp4", "video"],
    ["image/svg+xml", "image"],
  ])("recognizes %s for an extensionless filename", (mime, kind) => {
    expect(attachmentFileType("download", mime).kind).toBe(kind);
  });

  it("prefers a recognized MIME kind when the extension disagrees", () => {
    expect(attachmentFileType("not-an-image.png", "application/pdf")).toEqual({
      kind: "pdf",
      label: "PNG",
    });
  });

  it("does not treat names containing dots in a parent directory as an extension", () => {
    expect(attachmentFileType("folder.zip/README")).toEqual({ kind: "file", label: "FILE" });
    expect(attachmentFileType("folder.zip\\README")).toEqual({ kind: "file", label: "FILE" });
  });

  it("keeps a readable fallback for long or non-alphanumeric suffixes", () => {
    expect(attachmentFileType("file.averylongextension")).toEqual({ kind: "file", label: "FILE" });
    expect(attachmentFileType("file.<script>")).toEqual({ kind: "file", label: "FILE" });
  });

  it("does not classify inherited object property names as file types", () => {
    expect(attachmentFileType("file.constructor")).toEqual({ kind: "file", label: "FILE" });
    expect(attachmentFileType("README", "__proto__")).toEqual({ kind: "file", label: "FILE" });
  });
});
