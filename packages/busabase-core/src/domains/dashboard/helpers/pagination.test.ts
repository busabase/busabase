import { describe, expect, it } from "vitest";
import {
  clampPaginationPage,
  getPaginationItems,
  getPaginationRange,
  getTotalPages,
  paginateItems,
} from "./pagination";

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

describe("getTotalPages", () => {
  it("rounds up and never returns zero pages", () => {
    expect(getTotalPages(68, 24)).toBe(3);
    expect(getTotalPages(48, 24)).toBe(2);
    expect(getTotalPages(0, 24)).toBe(1);
  });
});

describe("paginateItems", () => {
  const items = Array.from({ length: 68 }, (_, index) => index + 1);

  it("slices the requested page", () => {
    const second = paginateItems(items, 2, 24);
    expect(second.items).toEqual(items.slice(24, 48));
    expect(second).toMatchObject({ page: 2, totalPages: 3, total: 68 });
  });

  it("returns the short final page", () => {
    expect(paginateItems(items, 3, 24).items).toEqual(items.slice(48));
  });

  it("clamps a page past the end to the last page, e.g. after a search shrinks the list", () => {
    const clamped = paginateItems(items.slice(0, 10), 3, 24);
    expect(clamped.page).toBe(1);
    expect(clamped.items).toHaveLength(10);
  });

  it("treats an empty list as one empty page", () => {
    expect(paginateItems([], 2, 24)).toEqual({ items: [], page: 1, totalPages: 1, total: 0 });
  });
});
