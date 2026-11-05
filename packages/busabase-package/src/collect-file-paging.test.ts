/**
 * `export` of a Drive reads its file list through the paged `fileTrees.listFiles`
 * and follows the cursor, so a Drive bigger than one page is still exported
 * completely. A Busabase that predates paging ignores `limit`/`after` and
 * answers with the SAME full list every call — the loop has to notice and stop,
 * or the export never reaches the point where it reads file contents.
 */

import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it, vi } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";
import type { PackageFileTreeNode, PackageTree } from "./tree";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "big-drive",
  description: "",
  tags: [],
});

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    path: `file-${String(index).padStart(5, "0")}.md`,
    assetId: `ast_${index}`,
    name: `file-${String(index).padStart(5, "0")}.md`,
    size: 1,
    mimeType: "text/markdown",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

const driveRoot: SourceNode = {
  id: "nod-big-drive",
  slug: "big-drive",
  name: "Big Drive",
  type: "drive",
  description: "",
  position: 0,
};

const clientWith = (listFiles: ReturnType<typeof vi.fn>) =>
  ({
    fileTrees: {
      listFiles,
      // Every file reads back as the same one-byte document; this test counts
      // rows, not contents.
      readFile: async ({ filePath }: { filePath: string }) => ({
        nodeId: driveRoot.id,
        path: filePath,
        encoding: "utf8",
        content: "x",
        mimeType: "text/markdown",
        contentHash: "sha256:x",
      }),
    },
  }) as unknown as PackageClient;

const collect = (client: PackageClient) =>
  collectPackageTree(client, driveRoot, {
    manifest: manifest(),
    warn: () => {},
    baseUrl: "http://localhost",
  });

/** The Drive node's own file list — the rows this test counts. */
const driveFiles = (tree: PackageTree) => {
  const node = tree.nodes[0] as PackageFileTreeNode | undefined;
  if (!node || !("files" in node)) throw new Error("expected a file-tree node");
  return node.files;
};

describe("collectPackageTree — Drive file paging", () => {
  it("stops at a server that ignores the cursor, keeping the full list once", async () => {
    // One row more than a page, so an old server's single answer looks paged.
    const all = rows(5_001);
    const listFiles = vi.fn(async () => all);
    const files = driveFiles(await collect(clientWith(listFiles)));

    expect(files).toHaveLength(5_001);
    expect(new Set(files.map((file) => file.path)).size).toBe(5_001);
    expect(listFiles).toHaveBeenCalledTimes(2);
  }, 60_000);

  it("walks a paging server to the end", async () => {
    const all = rows(5_001);
    const listFiles = vi.fn(async ({ after }: { after?: string }) => {
      if (!after) return all.slice(0, 5_000);
      return all.filter((row) => row.path > after);
    });
    const files = driveFiles(await collect(clientWith(listFiles)));

    expect(files).toHaveLength(5_001);
    expect(listFiles).toHaveBeenCalledTimes(2);
  }, 60_000);
});
