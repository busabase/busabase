import { describe, expect, it } from "vitest";
import {
  buildFileTreeRenameOperations,
  fileTreeUploadPath,
  formatFileTreeBytes,
  inferFileTreeMimeType,
  normalizeFileTreeFolder,
  resolveFileTreePreviewKind,
  validateFileTreeFolder,
  validateFileTreeName,
  validateFileTreePath,
} from "./file-tree-files";

describe("file tree file helpers", () => {
  it("recognizes files by extension when an agent stored a generic MIME type", () => {
    expect(inferFileTreeMimeType("PHOTO.JPG", "application/octet-stream")).toBe("image/jpeg");
    expect(resolveFileTreePreviewKind("PHOTO.JPG", "application/octet-stream")).toBe("image");
    expect(resolveFileTreePreviewKind("README.md", "text/plain; charset=utf-8")).toBe("markdown");
  });

  it("treats a stored text/plain as uninformative for types the extension knows", () => {
    // The backend labels every text-shaped upload `text/plain`, so an SVG would
    // otherwise be shown as source instead of rendered.
    expect(inferFileTreeMimeType("logo.svg", "text/plain; charset=utf-8")).toBe("image/svg+xml");
    expect(resolveFileTreePreviewKind("logo.svg", "text/plain; charset=utf-8")).toBe("image");
    // A genuine text file the table does not know keeps its stored type.
    expect(inferFileTreeMimeType("notes.txt", "text/plain; charset=utf-8")).toBe("text/plain");
    expect(resolveFileTreePreviewKind("notes.txt", "text/plain; charset=utf-8")).toBe("code");
    expect(inferFileTreeMimeType("data.csv", "text/plain; charset=utf-8")).toBe("text/plain");
    // An explicit, informative type is never second-guessed.
    expect(inferFileTreeMimeType("chart.png", "image/png")).toBe("image/png");
  });

  it("normalizes upload folders without accepting absolute paths", () => {
    expect(normalizeFileTreeFolder(" reference//images/ ")).toBe("reference/images");
    expect(fileTreeUploadPath("reference/images", "logo.png")).toBe("reference/images/logo.png");
    expect(validateFileTreePath("reference/images/logo.png")).toBeNull();
    expect(validateFileTreePath("/reference/logo.png")).toBe("relative");
    expect(validateFileTreePath("reference/../logo.png")).toBe("invalid");
    expect(validateFileTreeFolder("/reference")).toBe("relative");
    expect(validateFileTreeFolder("reference/../images")).toBe("invalid");
    expect(validateFileTreeName("nested/logo.png")).toBe("invalid");
  });

  it("formats selected upload sizes up to GB", () => {
    expect(formatFileTreeBytes(512)).toBe("512 B");
    expect(formatFileTreeBytes(2048)).toBe("2 KB");
    expect(formatFileTreeBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileTreeBytes(64 * 1024 * 1024)).toBe("64 MB");
    expect(formatFileTreeBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatFileTreeBytes(12 * 1024 * 1024 * 1024)).toBe("12 GB");
  });

  it("renames a file by mounting the same asset at the new path before removing the old path", () => {
    expect(
      buildFileTreeRenameOperations(
        {
          assetId: "ast_logo",
          displayName: "logo.png",
          mimeType: "image/png",
          path: "brand/logo.png",
        },
        "logo-final.png",
        `sha256:${"a".repeat(64)}`,
      ),
    ).toEqual({
      nextPath: "brand/logo-final.png",
      operations: [
        {
          kind: "create",
          path: "brand/logo-final.png",
          assetId: "ast_logo",
          displayName: "logo-final.png",
          mimeType: "image/png",
        },
        {
          kind: "delete",
          path: "brand/logo.png",
          baseContentHash: `sha256:${"a".repeat(64)}`,
        },
      ],
    });
  });
});
