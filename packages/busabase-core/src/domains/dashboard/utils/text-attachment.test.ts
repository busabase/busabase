import { describe, expect, it } from "vitest";
import { attachmentTextKind, decodeTextChunk, isMarkdownAttachment } from "./text-attachment";

describe("text attachment routing", () => {
  it.each([
    ["notes.TXT", "application/octet-stream"],
    ["server.log", "image/png"],
    ["index.HTML", "text/html"],
    ["app.tsx", "image/jpeg"],
    ["data.jsonl", "application/octet-stream"],
    ["config.yaml", "application/yaml"],
    ["Dockerfile", "application/octet-stream"],
    ["unknown", "Text/Plain; charset=iso-8859-1"],
    ["download", "application/javascript"],
    ["download", "application/ld+json; charset=utf-8"],
    ["download", "application/rss+xml"],
    ["download", "application/vnd.example+yaml"],
  ])("reads %s with MIME %s as source text", (fileName, mimeType) => {
    expect(attachmentTextKind({ fileName, mimeType })).toBe("text");
  });

  it.each([
    ["report.MD", "image/png"],
    ["report", "Text/Markdown; charset=utf-8"],
    ["report", "text/x-markdown"],
  ])("retains Markdown mode for %s", (fileName, mimeType) => {
    expect(attachmentTextKind({ fileName, mimeType })).toBe("markdown");
  });

  it.each([
    ["photo.png", "text/plain"],
    ["vector.svg", "text/plain"],
    ["report.pdf", "text/plain"],
    ["report.docx", "text/plain"],
    ["data.csv", "text/plain"],
    ["data.xlsx", "text/plain"],
    ["captions.vtt", "text/plain"],
    ["book.epub", "text/plain"],
    ["archive.zip", "text/plain"],
    ["unknown.bin", "application/octet-stream"],
    ["unknown", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["unknown", "application/vnd.ms-visio.drawing.main+xml"],
    ["unknown", "application/epub+zip"],
    ["unknown", "image/svg+xml"],
    ["unknown", "text/csv"],
    ["unknown", "text/rtf"],
    ["unknown", "text/vtt"],
  ])("preserves native, rich or binary routing for %s with MIME %s", (fileName, mimeType) => {
    expect(attachmentTextKind({ fileName, mimeType })).toBeNull();
  });
});

describe("Markdown attachment identification and encoding", () => {
  it.each([
    ["report.MD", "application/octet-stream"],
    ["课程.markdown", "image/png"],
    ["report", "Text/Markdown; charset=windows-1252"],
    ["report", "text/x-markdown"],
  ])("identifies %s despite inaccurate metadata", (fileName, mimeType) => {
    expect(isMarkdownAttachment({ fileName, mimeType })).toBe(true);
  });

  it("leaves other attachment formats on their own viewer", () => {
    expect(isMarkdownAttachment({ fileName: "report.md.pdf", mimeType: "application/pdf" })).toBe(
      false,
    );
    expect(isMarkdownAttachment({ fileName: "report.txt", mimeType: "text/plain" })).toBe(false);
  });

  it("decodes BOM, split CJK/emoji bytes and a legitimate replacement character without loss", () => {
    const bytes = new TextEncoder().encode("\uFEFF# 中文 🧪 �\r\n");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let result = "";
    for (const byte of bytes) result += decodeTextChunk(decoder, new Uint8Array([byte]));
    result += decodeTextChunk(decoder);
    expect(result).toBe("# 中文 🧪 �\r\n");
  });

  it.each([
    [new Uint8Array([0xff, 0xfe, 0x23, 0x00])],
    [new Uint8Array([0x61, 0x00, 0x62])],
    [new Uint8Array([0xc3, 0x28])],
  ])("rejects bytes that cannot be displayed as UTF-8 text", (bytes) => {
    expect(() => decodeTextChunk(new TextDecoder("utf-8", { fatal: true }), bytes)).toThrow(
      "encoding",
    );
  });

  it("rejects an unfinished multi-byte sequence at the end", () => {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decodeTextChunk(decoder, new Uint8Array([0xe4, 0xb8]));
    expect(() => decodeTextChunk(decoder)).toThrow("encoding");
  });
});
