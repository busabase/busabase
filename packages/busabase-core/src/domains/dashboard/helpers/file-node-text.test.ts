import { describe, expect, it } from "vitest";
import {
  FILE_NODE_TEXT_PREVIEW_MAX_BYTES,
  fileNodeTextContent,
  fileNodeTextKind,
} from "./file-node-text";

const asset = (name: string, mimeType: string, overrides = {}) => ({
  name,
  mimeType,
  contentKind: "text" as const,
  textStatus: "present",
  size: 120,
  ...overrides,
});

describe("fileNodeTextKind", () => {
  it.each([
    ["notes.md", "text/markdown", "markdown"],
    ["notes.markdown", "application/octet-stream", "markdown"],
    ["main.py", "text/x-python", "code"],
    ["config.json", "application/json", "code"],
    ["server.log", "text/plain", "code"],
  ])("previews %s as %s", (name, mimeType, expected) => {
    expect(fileNodeTextKind(asset(name, mimeType))).toBe(expected);
  });

  it("leaves media to the media preview, even when its bytes are text", () => {
    expect(fileNodeTextKind(asset("logo.svg", "image/svg+xml"))).toBeNull();
  });

  it("keeps the Open file link for binary, unread, or oversized files", () => {
    expect(fileNodeTextKind(asset("a.md", "text/markdown", { contentKind: "binary" }))).toBeNull();
    expect(fileNodeTextKind(asset("a.md", "text/markdown", { textStatus: "missing" }))).toBeNull();
    expect(
      fileNodeTextKind(
        asset("a.md", "text/markdown", { size: FILE_NODE_TEXT_PREVIEW_MAX_BYTES + 1 }),
      ),
    ).toBeNull();
  });
});

describe("fileNodeTextContent", () => {
  const read = (lines: string[], overrides = {}) => ({
    lines,
    startLine: 1,
    endLine: Math.max(lines.length, 1),
    totalLines: lines.length,
    truncated: false,
    ...overrides,
  });

  it("joins the lines of a complete read", () => {
    expect(fileNodeTextContent(read(["# Notes", "", "- one"]))).toBe("# Notes\n\n- one");
  });

  it("gives up on a read cut short", () => {
    expect(fileNodeTextContent(read(["a", "b"], { totalLines: 5000 }))).toBeNull();
    expect(fileNodeTextContent(read(["a"], { truncated: true }))).toBeNull();
  });

  it("gives up on text that was not UTF-8", () => {
    expect(fileNodeTextContent(read(["��,�"]))).toBeNull();
  });
});
