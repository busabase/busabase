import { describe, expect, it } from "vitest";
import {
  buildFileTreeFolderRenamePlan,
  fileTreeSelectionKey,
  fileTreeZipEntryPath,
  resolveFileTreeSelectedPaths,
} from "./file-tree-bulk-actions";

const files = [
  {
    assetId: "ast_root",
    displayName: "root.txt",
    mimeType: "text/plain",
    path: "root.txt",
  },
  {
    assetId: "ast_guide",
    displayName: "guide.md",
    mimeType: "text/plain",
    path: "docs/guide.md",
  },
  {
    assetId: "ast_logo",
    displayName: "logo.png",
    mimeType: "image/png",
    path: "docs/images/logo.png",
  },
];

describe("Drive bulk action planning", () => {
  it("expands folders and deduplicates a selected parent plus selected children", () => {
    const selection = new Set([
      fileTreeSelectionKey("folder", "docs"),
      fileTreeSelectionKey("folder", "docs/images"),
      fileTreeSelectionKey("file", "docs/guide.md"),
    ]);

    expect(resolveFileTreeSelectedPaths(selection, files)).toEqual([
      "docs/guide.md",
      "docs/images/logo.png",
    ]);
  });

  it("keeps select-all output stable in the original file order", () => {
    const selection = new Set(files.map((file) => fileTreeSelectionKey("file", file.path)));
    expect(resolveFileTreeSelectedPaths(selection, files)).toEqual([
      "root.txt",
      "docs/guide.md",
      "docs/images/logo.png",
    ]);
  });

  it("renames a folder in the same parent with the same Assets and preserved descendants", () => {
    const result = buildFileTreeFolderRenamePlan({
      contentHashes: new Map([
        ["docs/guide.md", "sha256:guide"],
        ["docs/images/logo.png", "sha256:logo"],
      ]),
      existingPaths: new Set(files.map((file) => file.path)),
      files,
      folderPath: "docs",
      nextName: "handbook",
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        currentFolderPath: "docs",
        nextFolderPath: "handbook",
        sourcePaths: ["docs/guide.md", "docs/images/logo.png"],
        targetPaths: ["handbook/guide.md", "handbook/images/logo.png"],
        operations: [
          {
            kind: "create",
            path: "handbook/guide.md",
            assetId: "ast_guide",
            displayName: "guide.md",
            mimeType: "text/markdown",
          },
          {
            kind: "create",
            path: "handbook/images/logo.png",
            assetId: "ast_logo",
            displayName: "logo.png",
            mimeType: "image/png",
          },
          { kind: "delete", path: "docs/guide.md", baseContentHash: "sha256:guide" },
          { kind: "delete", path: "docs/images/logo.png", baseContentHash: "sha256:logo" },
        ],
      },
    });
  });

  it("blocks a folder rename when any target file already exists", () => {
    const result = buildFileTreeFolderRenamePlan({
      existingPaths: new Set([...files.map((file) => file.path), "handbook/guide.md"]),
      files,
      folderPath: "docs",
      nextName: "handbook",
    });

    expect(result).toEqual({
      ok: false,
      reason: "collision",
      paths: ["handbook/guide.md"],
    });
  });

  it("rejects a no-op or invalid folder name", () => {
    expect(
      buildFileTreeFolderRenamePlan({
        existingPaths: new Set(files.map((file) => file.path)),
        files,
        folderPath: "docs",
        nextName: "docs",
      }),
    ).toEqual({ ok: false, reason: "sameName", paths: [] });
    expect(
      buildFileTreeFolderRenamePlan({
        existingPaths: new Set(files.map((file) => file.path)),
        files,
        folderPath: "docs",
        nextName: "nested/name",
      }),
    ).toEqual({ ok: false, reason: "invalidName", paths: [] });
  });

  it("preserves relative directories and removes unsafe ZIP path segments", () => {
    expect(fileTreeZipEntryPath("docs/images/logo.png")).toBe("docs/images/logo.png");
    expect(fileTreeZipEntryPath("/docs/../images/logo.png")).toBe("docs/images/logo.png");
    expect(fileTreeZipEntryPath("docs\\images\\logo.png")).toBe("docs/images/logo.png");
  });
});
