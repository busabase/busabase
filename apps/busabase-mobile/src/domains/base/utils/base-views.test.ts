import type { ViewVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  canDeleteView,
  LAST_VIEW_DELETE_MESSAGE,
  orderViews,
  resolveActiveView,
} from "./base-views";

const view = (id: string, position: number, createdAt: string) =>
  ({ id, name: id, position, createdAt }) as unknown as ViewVO;

describe("orderViews", () => {
  it("puts views in their shared order, leftmost first", () => {
    const views = [
      view("board", 2, "2026-01-01T00:00:00.000Z"),
      view("grid", 0, "2026-03-01T00:00:00.000Z"),
      view("mine", 1, "2026-02-01T00:00:00.000Z"),
    ];
    expect(orderViews(views).map((item) => item.id)).toEqual(["grid", "mine", "board"]);
  });

  it("breaks position ties by creation time, as the server does", () => {
    const views = [
      view("later", 0, "2026-02-01T00:00:00.000Z"),
      view("earlier", 0, "2026-01-01T00:00:00.000Z"),
    ];
    expect(orderViews(views).map((item) => item.id)).toEqual(["earlier", "later"]);
  });

  it("does not reorder the list it was given", () => {
    const views = [
      view("b", 1, "2026-01-01T00:00:00.000Z"),
      view("a", 0, "2026-01-01T00:00:00.000Z"),
    ];
    orderViews(views);
    expect(views.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("resolveActiveView", () => {
  const ordered = [
    view("grid", 0, "2026-01-01T00:00:00.000Z"),
    view("board", 1, "2026-01-02T00:00:00.000Z"),
  ];

  it("opens a Base on its first view when nothing was picked", () => {
    // There is no unsaved "All" option any more: the leftmost saved view is
    // what a Base opens on.
    expect(resolveActiveView(ordered, null)?.id).toBe("grid");
  });

  it("keeps the view the user picked", () => {
    expect(resolveActiveView(ordered, "board")?.id).toBe("board");
  });

  it("falls back to the first view when the picked one is gone", () => {
    expect(resolveActiveView(ordered, "deleted-view")?.id).toBe("grid");
  });

  it("returns null for a Base with no views instead of crashing", () => {
    // Should never happen — every Base keeps at least one view — but the
    // screen must still list the records unfiltered.
    expect(resolveActiveView([], null)).toBeNull();
    expect(resolveActiveView([], "anything")).toBeNull();
  });
});

describe("canDeleteView", () => {
  it("blocks deleting a Base's last view", () => {
    expect(canDeleteView([view("grid", 0, "2026-01-01T00:00:00.000Z")])).toBe(false);
    expect(canDeleteView([])).toBe(false);
  });

  it("allows deleting when another view remains", () => {
    expect(
      canDeleteView([
        view("grid", 0, "2026-01-01T00:00:00.000Z"),
        view("board", 1, "2026-01-02T00:00:00.000Z"),
      ]),
    ).toBe(true);
  });

  it("explains the rule in the server's own words", () => {
    expect(LAST_VIEW_DELETE_MESSAGE).toBe(
      "A Base must keep at least one view. Create another view before deleting this one.",
    );
  });
});
