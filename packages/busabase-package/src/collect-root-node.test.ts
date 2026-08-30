/**
 * `export <slug>` accepts any node, not just a folder. A folder's content lives
 * in `children`, but a Doc/Base/Drive/… node IS the content — it has no
 * `children` at all. Regression coverage for the bug where exporting such a
 * node directly silently walked zero nodes and produced an empty manifest.
 */

import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";
import { renderPackageTree } from "./layout-write";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "handbook",
  description: "",
  tags: [],
});

const stubClient = (docBody: string): PackageClient =>
  ({
    nodes: {
      get: async ({ type }: { nodeId: string; type: string }) =>
        type === "doc" ? { type: "doc", body: docBody } : undefined,
    },
  }) as unknown as PackageClient;

const docRoot: SourceNode = {
  id: "nod-handbook",
  slug: "handbook",
  name: "Handbook",
  type: "doc",
  description: "Team handbook",
  position: 0,
};

describe("collectPackageTree — non-folder root", () => {
  it("collects a bare Doc node exported directly, instead of walking its (nonexistent) children", async () => {
    const tree = await collectPackageTree(stubClient("# Handbook\n"), docRoot, {
      manifest: manifest(),
      warn: () => {},
      baseUrl: "http://localhost",
    });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ slug: "handbook", type: "doc", body: "# Handbook\n" });
  });

  it("renders the doc's content, not just a bare manifest", async () => {
    const tree = await collectPackageTree(stubClient("# Handbook\n"), docRoot, {
      manifest: manifest(),
      warn: () => {},
      baseUrl: "http://localhost",
    });
    const files = renderPackageTree(tree);
    expect([...files.keys()]).toContain("content/handbook.md");
  });
});
