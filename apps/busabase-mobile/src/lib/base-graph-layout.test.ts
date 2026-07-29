import type { BaseVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { buildBaseGraphLayout, getBaseGraphGrid } from "./base-graph-layout";

const makeBase = (index: number): BaseVO =>
  ({
    id: `base-${index}`,
    nodeId: `node-${index}`,
    name: `Base ${index}`,
    slug: `base-${index}`,
    description: "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: "2026-07-28T00:00:00.000Z",
    fields: [],
  }) satisfies BaseVO;

describe("buildBaseGraphLayout", () => {
  it("places dense workspaces into distinct, readable cells", () => {
    const layout = buildBaseGraphLayout(
      Array.from({ length: 42 }, (_, index) => makeBase(index)),
      1008,
      720,
    );
    const positions = layout.nodes.map((node) => `${node.x}:${node.y}`);

    expect(layout.nodes).toHaveLength(42);
    expect(new Set(positions).size).toBe(42);
    expect(layout.nodes.every((node) => node.x > 0 && node.x < 1008)).toBe(true);
    expect(layout.nodes.every((node) => node.y > 56 && node.y < 720)).toBe(true);
  });

  it("reflows a dense workspace into readable phone-width columns", () => {
    const grid = getBaseGraphGrid(42, 390);
    const layout = buildBaseGraphLayout(
      Array.from({ length: 42 }, (_, index) => makeBase(index)),
      390,
      grid.minHeight,
    );

    expect(grid).toMatchObject({ columns: 2, rows: 21 });
    expect(layout.nodes.every((node) => node.x > 0 && node.x < 390)).toBe(true);
    expect(new Set(layout.nodes.map((node) => node.y)).size).toBe(21);
  });
});
