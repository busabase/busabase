import { describe, expect, it } from "vitest";
import { fileContentKind, isReadOnlyAsset } from "./file-content-kind";

describe("fileContentKind", () => {
  it("treats a utf8 file as editable text", () => {
    expect(fileContentKind({ encoding: "utf8", mimeType: "text/markdown" })).toEqual({
      kind: "text",
    });
  });

  it("recognises an asset-backed image", () => {
    expect(fileContentKind({ encoding: "url", mimeType: "image/png" })).toEqual({ kind: "image" });
  });

  it("recognises any other asset as binary", () => {
    expect(fileContentKind({ encoding: "url", mimeType: "application/pdf" })).toEqual({
      kind: "binary",
    });
    expect(fileContentKind({ encoding: "url", mimeType: null })).toEqual({ kind: "binary" });
  });

  it("decides on encoding, not on the mime type", () => {
    // A markdown mime type on an ASSET-backed file is still an asset: its bytes
    // are in storage and its `content` came back empty. Opening it in an editor
    // whose save path writes text would replace the file with whatever was in
    // the box.
    expect(fileContentKind({ encoding: "url", mimeType: "text/markdown" })).toEqual({
      kind: "binary",
    });
    // And the converse: text is text even with an exotic mime type.
    expect(fileContentKind({ encoding: "utf8", mimeType: "application/x-ndjson" })).toEqual({
      kind: "text",
    });
  });

  it("falls back to text when the server said nothing", () => {
    // An older server that omits `encoding` behaves exactly as this app did
    // before the field was read — text, editable. It also never serves an
    // asset-backed file through this path, so there is nothing to protect.
    expect(fileContentKind({})).toEqual({ kind: "text" });
    expect(fileContentKind(null)).toEqual({ kind: "text" });
  });
});

describe("isReadOnlyAsset", () => {
  it("closes the editor for anything the server handed over as a url", () => {
    // The bug this guards: a real PNG accepted a text update with HTTP 200 and
    // came back as utf8 content "oops" — the image was gone.
    expect(isReadOnlyAsset({ encoding: "url", mimeType: "image/png" })).toBe(true);
    expect(isReadOnlyAsset({ encoding: "url", mimeType: "application/zip" })).toBe(true);
  });

  it("leaves text files editable", () => {
    expect(isReadOnlyAsset({ encoding: "utf8", mimeType: "text/plain" })).toBe(false);
    expect(isReadOnlyAsset(undefined)).toBe(false);
  });
});
