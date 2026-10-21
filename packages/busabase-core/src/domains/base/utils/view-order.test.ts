import { describe, expect, it } from "vitest";
import { compareViewOrder, sortViewsByOrder } from "./view-order";

describe("view tab order", () => {
  it("sorts by position, then creation time, then id", () => {
    const views = [
      { id: "c", position: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", position: 0, createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "a", position: 0, createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "d", position: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    expect(sortViewsByOrder(views).map((view) => view.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("compares Date and ISO-string creation times alike", () => {
    const at = "2026-03-04T05:06:07.000Z";
    expect(
      compareViewOrder(
        { id: "x", position: 2, createdAt: new Date(at) },
        { id: "x", position: 2, createdAt: at },
      ),
    ).toBe(0);
  });

  it("does not reorder the input array", () => {
    const views = [
      { id: "b", position: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "a", position: 0, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    sortViewsByOrder(views);
    expect(views.map((view) => view.id)).toEqual(["b", "a"]);
  });
});
