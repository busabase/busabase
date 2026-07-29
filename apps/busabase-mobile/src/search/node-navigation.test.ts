import { NODE_TYPES, type NodeType } from "busabase-contract/domains";
import { describe, expect, it } from "vitest";
import { getMobileNodeDestination, isMobileNodePathActive } from "./node-navigation";

const expectedPaths: Record<NodeType, string> = {
  airapp: "/airapp/[nodeId]",
  base: "/base/[slug]",
  doc: "/doc/[nodeId]",
  drive: "/drive/[nodeId]",
  file: "/file/[nodeId]",
  folder: "/folder/[nodeId]",
  form: "/form/[nodeId]",
  html: "/html/[nodeId]",
  skill: "/skill/[nodeId]",
  whiteboard: "/whiteboard/[nodeId]",
  workflow: "/workflow/[nodeId]",
};

describe("mobile node navigation", () => {
  it("provides a detail route for every built-in node type", () => {
    expect(Object.keys(expectedPaths).sort()).toEqual([...NODE_TYPES].sort());

    for (const type of NODE_TYPES) {
      const destination = getMobileNodeDestination({
        id: `node-${type}`,
        type,
        slug: `slug-${type}`,
      });
      expect(destination.status).toBe("ready");
      if (destination.status === "ready") {
        expect(destination.pathname).toBe(expectedPaths[type]);
      }
    }
  });

  it("recognizes list and nested detail paths for every node type", () => {
    for (const type of NODE_TYPES) {
      const node = { id: `node-${type}`, type, slug: `slug-${type}` };
      const destination = getMobileNodeDestination(node);
      expect(destination.status).toBe("ready");
      if (destination.status !== "ready") continue;
      const path =
        type === "base" ? `/base/${node.slug}` : destination.pathname.replace("[nodeId]", node.id);
      expect(isMobileNodePathActive(node, path)).toBe(true);
      expect(isMobileNodePathActive(node, `${path}/edit`)).toBe(true);
    }
  });
});
