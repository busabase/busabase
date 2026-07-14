import { describe, expect, it } from "vitest";
import type { NodeTreeVO } from "../scripts/demo/_client";
import { DEMO_BASES } from "../scripts/demo/_data";
import {
  findFolderBySlug,
  findNode,
  folderSlugForSeedNodeId,
  needsMove,
  STANDARD_DEMO_FOLDERS,
} from "../scripts/demo/_nodes";

const tree: NodeTreeVO[] = [
  {
    id: "root-id",
    slug: "root",
    name: "Root",
    type: "folder",
    children: [
      {
        id: "marketing-id",
        slug: "marketing",
        name: "Marketing",
        type: "folder",
        children: [{ id: "blog-id", slug: "blog", name: "Blog", type: "base" }],
      },
    ],
  },
];

describe("demo node placement helpers", () => {
  it("finds nested folders by stable slug", () => {
    expect(findFolderBySlug(tree, "marketing")?.node.id).toBe("marketing-id");
  });

  it("reports the current parent for self-healing decisions", () => {
    expect(findNode(tree, (node) => node.slug === "blog")?.parentId).toBe("marketing-id");
    expect(needsMove(tree, "blog", "marketing")).toBe(false);

    const misplaced = structuredClone(tree);
    const marketing = misplaced[0]?.children?.[0];
    const blog = marketing?.children?.shift();
    if (blog) misplaced[0]?.children?.push(blog);
    expect(needsMove(misplaced, "blog", "marketing")).toBe(true);
  });

  it("maps every demo base seed folder to a remote folder slug", () => {
    for (const base of DEMO_BASES) {
      expect(folderSlugForSeedNodeId(base.folderNodeId), base.slug).toBeTruthy();
    }
  });

  it("includes folders for every standard non-base demo node type", () => {
    expect(STANDARD_DEMO_FOLDERS.map((folder) => folder.slug)).toEqual(
      expect.arrayContaining(["docs", "files", "skills", "drives", "airapps"]),
    );
  });
});
