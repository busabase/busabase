/**
 * Export's half of the template round trip: the Skill node an install lifted out
 * of a package root has to go back to the root, not become a node under
 * `content/`. If it did, every export→install cycle would leave one more copy of
 * the manual beside the last.
 */

import { TEMPLATE_SKILL_METADATA_KEY } from "busabase-contract/domains/package/template";
import { PACKAGE_FORMAT, type PackageManifest } from "busabase-contract/domains/package/types";
import { describe, expect, it } from "vitest";
import type { PackageClient } from "./client";
import { collectPackageTree, type SourceNode } from "./collect";
import { renderPackageTree } from "./layout-write";

const manifest = (): PackageManifest => ({
  format: PACKAGE_FORMAT,
  name: "kelly-email",
  description: "",
  tags: [],
});

/** Only the two file-tree calls collect makes for a Skill node. */
const stubClient = (filesByNode: Record<string, Record<string, string>>): PackageClient =>
  ({
    fileTrees: {
      listFiles: async ({ nodeId }: { nodeId: string }) =>
        Object.keys(filesByNode[nodeId] ?? {}).map((path) => ({ path })),
      readFile: async ({ nodeId, filePath }: { nodeId: string; filePath: string }) => ({
        encoding: "utf8" as const,
        content: filesByNode[nodeId]?.[filePath] ?? "",
      }),
    },
  }) as unknown as PackageClient;

const skillNode = (metadata: Record<string, unknown> | null): SourceNode => ({
  id: "nod-skill",
  slug: "kelly-email",
  name: "Kelly Email",
  type: "skill",
  description: "Inbox triage desk",
  position: 0,
  metadata,
});

const collect = async (children: SourceNode[]) =>
  collectPackageTree(
    stubClient({
      "nod-skill": { "SKILL.md": "---\nname: kelly-email\n---\n", "references/a.md": "# a\n" },
      "nod-other": { "SKILL.md": "---\nname: other\n---\n" },
    }),
    {
      id: "nod-root",
      slug: "kelly-email",
      name: "Kelly Email",
      type: "folder",
      description: "",
      position: 0,
      children,
    },
    { manifest: manifest(), warn: () => {}, baseUrl: "http://localhost" },
  );

describe("collectPackageTree — the template skill", () => {
  it("lifts a stamped Skill node to the package root", async () => {
    const tree = await collect([skillNode({ [TEMPLATE_SKILL_METADATA_KEY]: true })]);
    expect(tree.rootSkill?.slug).toBe("kelly-email");
    expect(tree.rootSkill?.files.map((file) => file.path)).toEqual(["SKILL.md", "references/a.md"]);
    // ...and it is NOT also a node.
    expect(tree.nodes).toEqual([]);
  });

  it("renders the lifted skill at the root, never under content/", async () => {
    const tree = await collect([skillNode({ [TEMPLATE_SKILL_METADATA_KEY]: true })]);
    const files = renderPackageTree(tree);
    expect(files.has("SKILL.md")).toBe(true);
    expect(files.has("references/a.md")).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith("content/kelly-email/"))).toBe(false);
  });

  it("leaves an ordinary, unstamped Skill node under content/", async () => {
    const tree = await collect([skillNode(null)]);
    expect(tree.rootSkill).toBeUndefined();
    expect(tree.nodes.map((node) => node.slug)).toEqual(["kelly-email"]);
    expect(renderPackageTree(tree).has("content/kelly-email/SKILL.md")).toBe(true);
  });

  it("lifts only the first stamped skill, exporting a second one visibly rather than dropping it", async () => {
    const second: SourceNode = {
      ...skillNode({ [TEMPLATE_SKILL_METADATA_KEY]: true }),
      id: "nod-other",
      slug: "other",
      name: "Other",
    };
    const tree = await collect([skillNode({ [TEMPLATE_SKILL_METADATA_KEY]: true }), second]);
    expect(tree.rootSkill?.slug).toBe("kelly-email");
    expect(tree.nodes.map((node) => node.slug)).toEqual(["other"]);
  });
});
