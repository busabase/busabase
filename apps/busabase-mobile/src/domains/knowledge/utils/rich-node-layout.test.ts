import type { WorkflowDocument } from "busabase-contract/domains/rich-node/types";
import { describe, expect, it } from "vitest";
import {
  buildWorkflowCanvasLayout,
  getWhiteboardSceneBounds,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from "./rich-node-layout";

describe("getWhiteboardSceneBounds", () => {
  it("contains positioned shapes and line points with canvas padding", () => {
    const bounds = getWhiteboardSceneBounds([
      { id: "box", type: "rectangle", x: 80, y: 120, width: 250, height: 100 },
      {
        id: "line",
        type: "line",
        x: 300,
        y: 200,
        points: [
          [0, 0],
          [420, 160],
        ],
      },
      { id: "deleted", type: "rectangle", x: 900, y: 900, width: 50, height: 50, isDeleted: true },
    ]);

    expect(bounds.x).toBeLessThan(80);
    expect(bounds.y).toBeLessThan(120);
    expect(bounds.x + bounds.width).toBeGreaterThan(720);
    expect(bounds.y + bounds.height).toBeGreaterThan(360);
  });

  it("returns a stable empty-canvas viewport", () => {
    expect(getWhiteboardSceneBounds([])).toEqual({ x: 0, y: 0, width: 640, height: 420 });
  });
});

describe("buildWorkflowCanvasLayout", () => {
  it("normalizes authored positions into a padded scrollable canvas", () => {
    const document = {
      version: 2,
      nodes: [
        {
          id: "trigger",
          kind: "trigger",
          position: { x: -80, y: 40 },
          label: "Start",
          description: "",
          eventName: "manual",
        },
        {
          id: "finish",
          kind: "end",
          position: { x: 420, y: 240 },
          label: "Done",
          description: "",
          outcome: "completed",
        },
      ],
      edges: [{ id: "edge", source: "trigger", target: "finish", label: "", outcome: "default" }],
      settings: { executionMode: "manual", concurrency: 1, timeoutMs: 30_000, errorPolicy: "stop" },
    } satisfies WorkflowDocument;

    const layout = buildWorkflowCanvasLayout(document);

    expect(layout.nodes.get("trigger")).toMatchObject({ x: 32, y: 32 });
    expect(layout.nodes.get("finish")).toMatchObject({ x: 532, y: 232 });
    expect(layout.width).toBe(532 + WORKFLOW_NODE_WIDTH + 32);
    expect(layout.height).toBe(232 + WORKFLOW_NODE_HEIGHT + 32);
  });
});
