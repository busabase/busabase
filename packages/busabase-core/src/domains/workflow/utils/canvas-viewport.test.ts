import { describe, expect, it } from "vitest";
import { getNewWorkflowNodePosition, getWorkflowNodeViewport } from "./canvas-viewport";

const card = (id: string, x: number, y = 0) => ({ id, position: { x, y } });

describe("new workflow step placement", () => {
  it("starts an empty canvas at the visible center", () => {
    expect(getNewWorkflowNodePosition([], null, { x: 500, y: 300 })).toEqual({ x: 388, y: 261 });
  });

  it("uses the selected step rather than the total number of steps", () => {
    const nodes = [card("selected", -900, 1200), card("far", 8000, -6000)];
    expect(getNewWorkflowNodePosition(nodes, "selected", { x: 0, y: 0 })).toEqual({
      x: -628,
      y: 1200,
    });
  });

  it("skips a chain of occupied areas independent of input order", () => {
    const nodes = [card("third", 544), card("first", 0), card("second", 272)];
    expect(getNewWorkflowNodePosition(nodes, "first", { x: 0, y: 0 })).toEqual({ x: 816, y: 0 });
  });

  it("uses measured dimensions and ignores nodes in other rows", () => {
    const nodes = [
      { ...card("selected", 0), measured: { width: 400, height: 80 } },
      card("other-row", 448, 500),
      { ...card("wide", 440), measured: { width: 500, height: 100 } },
    ];
    expect(getNewWorkflowNodePosition(nodes, "selected", { x: 0, y: 0 })).toEqual({ x: 988, y: 0 });
  });

  it("does not overlap an existing node when no step is selected", () => {
    expect(getNewWorkflowNodePosition([card("existing", 0)], null, { x: 112, y: 39 })).toEqual({
      x: 272,
      y: 0,
    });
  });
});

describe("new workflow step visibility", () => {
  const canvas = { width: 800, height: 500 };
  const viewport = { x: 0, y: 0, zoom: 1 };

  it("leaves a fully visible card and zoom untouched", () => {
    expect(
      getWorkflowNodeViewport({ x: 100, y: 100, width: 224, height: 78 }, viewport, canvas),
    ).toBeNull();
  });

  it.each([
    { x: 4000, y: 3000 },
    { x: -4000, y: -3000 },
    { x: 4000, y: -3000 },
    { x: -4000, y: 3000 },
  ])("reveals the whole card at $x,$y without changing zoom", (position) => {
    const node = { ...position, width: 224, height: 78 };
    const next = getWorkflowNodeViewport(node, viewport, canvas);
    expect(next).not.toBeNull();
    if (!next) throw new Error("missing viewport");
    expect(next.zoom).toBe(1);
    expect(node.x * next.zoom + next.x).toBeGreaterThanOrEqual(24);
    expect((node.x + node.width) * next.zoom + next.x).toBeLessThanOrEqual(canvas.width - 24);
    expect(node.y * next.zoom + next.y).toBeGreaterThanOrEqual(24);
    expect((node.y + node.height) * next.zoom + next.y).toBeLessThanOrEqual(canvas.height - 24);
  });

  it("keeps the current zoom when the card fits", () => {
    const next = getWorkflowNodeViewport(
      { x: 6000, y: 9000, width: 224, height: 78 },
      { x: 120, y: -80, zoom: 0.5 },
      canvas,
    );
    expect(next?.zoom).toBe(0.5);
  });

  it("reduces zoom only when needed in a narrow canvas", () => {
    const node = { x: 1000, y: 1000, width: 224, height: 78 };
    const next = getWorkflowNodeViewport(
      node,
      { x: 0, y: 0, zoom: 1.8 },
      { width: 300, height: 220 },
    );
    expect(next?.zoom).toBeCloseTo(252 / 224);
  });
});
