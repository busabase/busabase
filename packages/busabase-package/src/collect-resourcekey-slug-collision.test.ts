/**
 * Regression coverage for a real production bug: restoring an installed
 * node's original slug (its `resourceKey` stamp) leaked onto an UNRELATED
 * node elsewhere in the space that happened to share the same current slug.
 *
 * Found live exporting the whole Vika Team space: a folder named
 * "social-media" contained an AirApp that install had renamed to
 * "social-media" too (matching its parent folder) — the app's own
 * `resourceKey: "airapp"` stamp says its package name was "airapp". The old
 * slug-restoration pass built ONE flat `Map<currentSlug, restoredSlug>` for
 * the whole exported tree and rewrote every node whose slug matched a key in
 * it — so `renames.set("social-media", "airapp")` (meant only for the app)
 * ALSO matched the parent FOLDER, which coincidentally had the exact same
 * current slug. The folder came out named "airapp" in the package, with the
 * app doubly nested one level deeper inside it.
 */
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "space",
  description: "",
  tags: [],
});

const stubClient = (): PackageClient =>
  ({
    fileTrees: {
      listFiles: async () => [{ path: "server.js" }],
      readFile: async () => ({ encoding: "utf8" as const, content: "// app\n" }),
    },
  }) as unknown as PackageClient;

describe("collectPackageTree — a folder's slug must not be renamed by an unrelated node's resourceKey", () => {
  it("keeps the folder's own slug when a child AirApp shares its CURRENT slug and gets restored", async () => {
    // Exactly the production shape: folder "social-media" contains an AirApp
    // whose current slug is ALSO "social-media" (install matched it to the
    // folder), stamped to restore back to "airapp".
    const root: SourceNode = {
      id: "nod-root",
      slug: "root",
      name: "Root",
      type: "folder",
      description: "",
      position: 0,
      children: [
        {
          id: "nod-folder",
          slug: "social-media",
          name: "Social Media",
          type: "folder",
          description: "",
          position: 0,
          children: [
            {
              id: "nod-app",
              slug: "social-media",
              name: "Social Media",
              type: "airapp",
              description: "",
              position: 0,
              metadata: { resourceKey: "airapp", appId: "social-media" },
            },
          ],
        },
      ],
    };

    const tree = await collectPackageTree(stubClient(), root, {
      manifest: manifest(),
      warn: () => {},
      baseUrl: "http://localhost",
    });

    const folder = tree.nodes.find((n) => n.type === "folder");
    expect(folder?.slug).toBe("social-media");
    expect(folder?.type).toBe("folder");
    const child = folder?.type === "folder" ? folder.children[0] : undefined;
    expect(child?.slug).toBe("airapp");
    expect(child?.type).toBe("airapp");
  });
});
