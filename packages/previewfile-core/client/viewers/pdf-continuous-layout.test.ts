import { describe, expect, it } from "vitest";
import { getPdfPageLayouts, getVisiblePdfPage } from "./pdf-continuous-layout";

const geometries = new Map([
  [1, { width: 600, height: 1000 }],
  [2, { width: 1200, height: 600 }],
]);
const options = {
  count: 2,
  geometries,
  viewport: { width: 800, height: 600 },
  manualScale: 1,
  gap: 12,
};

describe("continuous PDF layout", () => {
  it("fits portrait and landscape pages independently and leaves one gap", () => {
    expect(getPdfPageLayouts({ ...options, fitMode: "page" })).toEqual([
      { top: 0, width: 360, height: 600, scale: 0.6 },
      { top: 612, width: 800, height: 400, scale: 800 / 1200 },
    ]);
  });

  it("uses a shared manual scale while preserving physical page proportions", () => {
    expect(getPdfPageLayouts({ ...options, fitMode: "manual", manualScale: 1.5 })).toEqual([
      { top: 0, width: 900, height: 1500, scale: 1.5 },
      { top: 1512, width: 1800, height: 900, scale: 1.5 },
    ]);
  });

  it("estimates unmeasured pages with the first measured page until their dimensions arrive", () => {
    const result = getPdfPageLayouts({
      ...options,
      count: 3,
      fitMode: "width",
    });
    expect(result[2]?.height).toBeCloseTo(1000 * (800 / 600));
    const second = result[1];
    expect(result[2]?.top).toBeCloseTo((second?.top ?? 0) + (second?.height ?? 0) + 12);
  });

  it("selects the page occupying the greatest visible height and favors the earlier on ties", () => {
    const layouts = getPdfPageLayouts({ ...options, fitMode: "page" });
    expect(getVisiblePdfPage(layouts, 0, 600)).toBe(1);
    expect(getVisiblePdfPage(layouts, 306, 600)).toBe(1);
    expect(getVisiblePdfPage(layouts, 350, 600)).toBe(2);
    expect(getVisiblePdfPage(layouts, 612, 600)).toBe(2);
  });

  it("selects the last page at the bottom when the final pages fit in the viewport together", () => {
    const deck = new Map(
      Array.from({ length: 100 }, (_, index) => [index + 1, { width: 960, height: 540 }]),
    );
    const layouts = getPdfPageLayouts({
      count: 100,
      geometries: deck,
      viewport: { width: 800, height: 1000 },
      fitMode: "page",
      manualScale: 1,
      gap: 12,
    });
    const last = layouts[99];
    const bottom = (last?.top ?? 0) + (last?.height ?? 0) - 1000;
    expect(getVisiblePdfPage(layouts, bottom, 1000)).toBe(100);
    expect(getVisiblePdfPage(layouts, bottom - 0.5, 1000)).toBe(100);
    expect(getVisiblePdfPage(layouts, bottom - 50, 1000)).toBe(99);
  });

  it("keeps the first page when the whole document fits without scrolling", () => {
    const layouts = getPdfPageLayouts({ ...options, fitMode: "page" });
    expect(getVisiblePdfPage(layouts, 0, 2000)).toBe(1);
    expect(getVisiblePdfPage([], 0, 600)).toBe(1);
  });
});
