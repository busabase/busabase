import { describe, expect, it } from "vitest";
import { stableStringify } from "./stable-json";

describe("stableStringify", () => {
  it("treats objects that differ only in key order as equal", () => {
    // The exact shape jsonb reshuffling produces: same element, keys reordered.
    const saved = { id: "api-box", type: "rectangle", x: 100, y: 100, width: 400 };
    const readBack = { x: 100, y: 100, id: "api-box", type: "rectangle", width: 400 };
    expect(stableStringify(saved)).toBe(stableStringify(readBack));
    expect(JSON.stringify(saved)).not.toBe(JSON.stringify(readBack));
  });

  it("sorts keys at every depth", () => {
    const a = { version: 1, appState: { theme: "dark", gridSize: 20 }, elements: [] };
    const b = { elements: [], appState: { gridSize: 20, theme: "dark" }, version: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("keeps array order significant", () => {
    // z-order / step order is real data, not incidental ordering.
    expect(stableStringify([{ id: "a" }, { id: "b" }])).not.toBe(
      stableStringify([{ id: "b" }, { id: "a" }]),
    );
  });

  it("still reports genuinely different content as different", () => {
    expect(stableStringify({ id: "a", text: "before" })).not.toBe(
      stableStringify({ id: "a", text: "after" }),
    );
  });

  it("handles null, primitives and nested arrays", () => {
    expect(stableStringify({ a: null, b: [1, [2, { d: 1, c: 2 }]] })).toBe(
      stableStringify({ b: [1, [2, { c: 2, d: 1 }]], a: null }),
    );
  });
});
