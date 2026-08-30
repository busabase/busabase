/**
 * Nested demo folders + what the sidebar actually receives for them.
 *
 * The demo data set used to be exactly one folder level under the workspace
 * root, so the sidebar's depth-bounded prefetch (`nodes.list({ parentId: null,
 * depth: 2 })`) always happened to carry the entire tree and the lazy
 * "expand this folder" path was never exercised by seeded content. The
 * `Product Ops` branch (see `demo/scenarios/nested-folders.ts`) is 4 folder
 * levels deep on purpose; these tests pin the shape a sidebar sees at each
 * boundary, which is what a "clicked a second-level folder and it rendered
 * empty" regression shows up as.
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { buildDemoDataset, englishScenario } from "../src/demo/dataset";
import {
  NESTED_ARCHIVE_FOLDER_NODE_ID,
  NESTED_BRAND_KIT_FOLDER_NODE_ID,
  NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
  NESTED_LAUNCH_FOLDER_NODE_ID,
  NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
  NESTED_RETRO_FOLDER_NODE_ID,
} from "../src/demo/scenarios/nested-folders";
import { zhCnScenario } from "../src/demo/scenarios/zh-cn";
import { seedScenario as applyDemoScenario } from "../src/logic/seed";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

interface TreeNode {
  id: string;
  type: string;
  hasChildren?: boolean;
  children: TreeNode[];
}

const findNode = (nodes: TreeNode[], id: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return undefined;
};

describe("nested demo folders in the stateless demo dataset", () => {
  it.each([
    ["English", englishScenario],
    ["Simplified Chinese", zhCnScenario],
  ])("%s nests Product Ops four folder levels deep", (_locale, scenario) => {
    const { nodes } = buildDemoDataset("1", new Date("2026-08-27T00:00:00Z"), scenario);

    const productOps = findNode(nodes as TreeNode[], NESTED_PRODUCT_OPS_FOLDER_NODE_ID);
    expect(productOps).toBeDefined();
    // Subfolders sort ahead of a folder's own leaves, by position.
    expect(productOps?.children.map((child) => child.id)).toEqual([
      NESTED_LAUNCH_FOLDER_NODE_ID,
      NESTED_ARCHIVE_FOLDER_NODE_ID,
    ]);

    const launch = findNode(nodes as TreeNode[], NESTED_LAUNCH_FOLDER_NODE_ID);
    expect(launch?.children.map((child) => child.type)).toEqual(["folder", "html"]);

    const brandKit = findNode(nodes as TreeNode[], NESTED_BRAND_KIT_FOLDER_NODE_ID);
    expect(brandKit?.children.map((child) => child.type)).toEqual(["html"]);
  });
});

describe("nested demo folders through the depth-bounded sidebar fetch", () => {
  it("stops at the prefetch boundary, then hands the rest over on expand", async () => {
    await seedScenario("nested-folder-tree");
    const raw: RawClient = createRouterClient(busabaseRouter);
    await applyDemoScenario(englishScenario);

    // What the sidebar loads up front: root + 2 levels. `Product Ops` is
    // level 1, `2026 Launch` level 2 — the deepest prefetched level, so its
    // own children are absent and only `hasChildren` says they exist.
    const prefetched = (await raw.nodes.list({ parentId: null, depth: 2 })) as TreeNode[];
    const launch = findNode(prefetched, NESTED_LAUNCH_FOLDER_NODE_ID);
    expect(launch).toBeDefined();
    expect(launch?.children).toEqual([]);
    expect(launch?.hasChildren).toBe(true);
    // Nothing below level 2 came back — this is precisely the state in which
    // the sidebar has to ask for more.
    expect(findNode(prefetched, NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID)).toBeUndefined();

    // The lazy expand a click on `2026 Launch` triggers.
    const expanded = (await raw.nodes.list({
      parentId: NESTED_LAUNCH_FOLDER_NODE_ID,
      depth: 2,
    })) as TreeNode[];
    expect(expanded.map((node) => node.id)).toContain(NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID);
    // Two more levels arrive with it, so `Brand Kit` is already visible…
    const brandKit = findNode(expanded, NESTED_BRAND_KIT_FOLDER_NODE_ID);
    expect(brandKit).toBeDefined();
    // …and it is itself a depth boundary that still declares its own children.
    expect(brandKit?.children).toEqual([]);
    expect(brandKit?.hasChildren).toBe(true);

    // The second lazy expand, one level deeper.
    const deepest = (await raw.nodes.list({
      parentId: NESTED_BRAND_KIT_FOLDER_NODE_ID,
      depth: 2,
    })) as TreeNode[];
    expect(deepest.map((node) => node.type)).toEqual(["html"]);
  });
});

describe("nodes.ancestors — what the sidebar needs on a cold deep load", () => {
  it("returns the full chain root-first, by id and by slug, and [] at the top", async () => {
    await seedScenario("nested-folder-ancestors");
    const raw: RawClient = createRouterClient(busabaseRouter);
    await applyDemoScenario(englishScenario);

    // The whole point: one call, from the deepest node, naming every folder
    // that has to be expanded — none of which the sidebar has fetched yet.
    const deep = await raw.nodes.ancestors({ nodeId: NESTED_BRAND_KIT_FOLDER_NODE_ID });
    expect(deep.ancestorIds).toEqual([
      NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
      NESTED_LAUNCH_FOLDER_NODE_ID,
      NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
    ]);

    // A slug is what actually appears in the url the sidebar reads, so the
    // slug path must resolve identically to the id path.
    const bySlug = await raw.nodes.ancestors({ nodeId: "brand-kit" });
    expect(bySlug.ancestorIds).toEqual(deep.ancestorIds);

    // A leaf (non-folder) node resolves too — its chain is its folders.
    const leaf = await raw.nodes.ancestors({ nodeId: "launch-one-pager" });
    expect(leaf.ancestorIds).toEqual([
      NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
      NESTED_LAUNCH_FOLDER_NODE_ID,
      NESTED_LAUNCH_ASSETS_FOLDER_NODE_ID,
      NESTED_BRAND_KIT_FOLDER_NODE_ID,
    ]);

    // A sibling branch does not leak into another's chain.
    const retro = await raw.nodes.ancestors({ nodeId: NESTED_RETRO_FOLDER_NODE_ID });
    expect(retro.ancestorIds).toEqual([
      NESTED_PRODUCT_OPS_FOLDER_NODE_ID,
      NESTED_ARCHIVE_FOLDER_NODE_ID,
    ]);

    // A top-level folder sits directly under the workspace root, which the
    // sidebar strips — so there is nothing for it to expand.
    const top = await raw.nodes.ancestors({ nodeId: NESTED_PRODUCT_OPS_FOLDER_NODE_ID });
    expect(top.ancestorIds).toEqual([]);
  });
});
