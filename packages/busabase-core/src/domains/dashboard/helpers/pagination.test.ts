import { describe, expect, it } from "vitest";
import { clampPaginationPage, getPaginationItems, getPaginationRange } from "./pagination";

describe("getPaginationItems", () => {
  it("shows every page when the result fits without ellipses", () => {
    expect(getPaginationItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first pages and last page visible near the start", () => {
    expect(getPaginationItems(2, 20)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 20]);
  });

  it("keeps the first page and last pages visible near the end", () => {
    expect(getPaginationItems(19, 20)).toEqual([1, "ellipsis-start", 16, 17, 18, 19, 20]);
  });

  it("shows the current page and its neighbors between two ellipses", () => {
    expect(getPaginationItems(10, 20)).toEqual([
      1,
      "ellipsis-start",
      9,
      10,
      11,
      "ellipsis-end",
      20,
    ]);
  });

  it("clamps an out-of-range current page", () => {
    expect(getPaginationItems(99, 10)).toEqual([1, "ellipsis-start", 6, 7, 8, 9, 10]);
  });

  it("supports a wider sibling window", () => {
    expect(getPaginationItems(8, 16, 2)).toEqual([
      1,
      "ellipsis-start",
      6,
      7,
      8,
      9,
      10,
      "ellipsis-end",
      16,
    ]);
  });
});

describe("clampPaginationPage", () => {
  it("keeps the page within the available range", () => {
    expect(clampPaginationPage(-1, 6)).toBe(1);
    expect(clampPaginationPage(4, 6)).toBe(4);
    expect(clampPaginationPage(12, 6)).toBe(6);
  });
});

describe("getPaginationRange", () => {
  it("returns an empty range when there are no records", () => {
    expect(getPaginationRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });

  it("returns a bounded range for the final page", () => {
    expect(getPaginationRange(6, 50, 277)).toEqual({ from: 251, to: 277 });
  });

  it("clamps a stale page after the total shrinks", () => {
    expect(getPaginationRange(6, 50, 87)).toEqual({ from: 51, to: 87 });
  });
});
