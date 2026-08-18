import type { BaseVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildBaseGraphLayout,
  getBaseGraphGrid,
  summarizeBaseGraphRelations,
} from "./base-graph-layout";

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

  it("fits a dense workspace into the available iPad content width", () => {
    const grid = getBaseGraphGrid(42, 737);
    const layout = buildBaseGraphLayout(
      Array.from({ length: 42 }, (_, index) => makeBase(index)),
      737,
      grid.minHeight,
    );

    expect(grid).toMatchObject({ columns: 7, rows: 6 });
    expect(layout.nodes.every((node) => node.x > 0 && node.x < 737)).toBe(true);
    expect(new Set(layout.nodes.map((node) => node.y)).size).toBe(6);
  });

  it("counts each relation for its source and target base", () => {
    const source = makeBase(0);
    source.fields = [
      {
        id: "field-relation",
        baseId: source.id,
        name: "Company",
        slug: "company",
        type: "relation",
        required: false,
        position: 0,
        options: { targetBaseId: "base-1" },
      },
    ];
    const target = makeBase(1);
    const isolated = makeBase(2);

    const summary = summarizeBaseGraphRelations([source, target, isolated]);

    expect(summary.edgeCount).toBe(1);
    expect(summary.relationCountByBaseId.get(source.id)).toBe(1);
    expect(summary.relationCountByBaseId.get(target.id)).toBe(1);
    expect(summary.relationCountByBaseId.get(isolated.id)).toBe(0);
  });
});
