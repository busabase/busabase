import { describe, expect, it } from "vitest";
import {
  clampCropPoint,
  cropDragLimit,
  MAX_WHEEL_ZOOM_STEP,
  MIN_ZOOM,
  nextZoomFromWheel,
  placeCropOnImage,
  zoomChangeFromWheel,
} from "./crop-frame";

describe("workspace logo crop zoom", () => {
  it("moves a mouse notch by a small step instead of half a zoom level", () => {
    // react-easy-crop default: pixelY / 200. A 100px notch jumps 0.5.
    expect(100 / 200).toBe(0.5);
    expect(zoomChangeFromWheel(100)).toBe(MAX_WHEEL_ZOOM_STEP);
    expect(MAX_WHEEL_ZOOM_STEP).toBeLessThan(0.15);

    const afterOneNotch = nextZoomFromWheel(1.2, 100);
    expect(afterOneNotch).toBeCloseTo(1.12);
    expect(afterOneNotch).toBeGreaterThan(MIN_ZOOM);
  });

  it("caps a large wheel delta so one event cannot leap across the range", () => {
    expect(zoomChangeFromWheel(800, 2)).toBe(MAX_WHEEL_ZOOM_STEP);
    expect(nextZoomFromWheel(1.2, 800, 2)).toBeCloseTo(1.12);
  });

  it("keeps trackpad-sized deltas smaller than a mouse notch", () => {
    expect(zoomChangeFromWheel(8)).toBeLessThan(0.01);
    expect(zoomChangeFromWheel(-8)).toBeGreaterThan(-0.01);
  });

  it("zooms in when the wheel scrolls up", () => {
    expect(nextZoomFromWheel(1.2, -100)).toBeCloseTo(1.28);
  });
});

describe("workspace logo crop pan", () => {
  const square = { width: 200, height: 200 };

  it("lets a fully zoomed-out square image move", () => {
    // The library's max offset is (media * zoom - frame) / 2 = 0 here, so a
    // drag is discarded. Half the frame stays available.
    expect(cropDragLimit(200, 200, 1)).toBe(100);
    expect(clampCropPoint({ x: 40, y: -30 }, square, square, 1)).toEqual({ x: 40, y: -30 });
    expect(clampCropPoint({ x: 400, y: -400 }, square, square, 1)).toEqual({ x: 100, y: -100 });
  });

  it("lets the short side of a wide image move when zoomed out", () => {
    expect(cropDragLimit(400, 200, 1)).toBe(100);
    expect(cropDragLimit(200, 200, 1)).toBe(100);
  });

  it("eases the extra pan in as the image reaches a fit, instead of snapping", () => {
    const fitted = cropDragLimit(200, 200, 1);
    const oneNotchIn = cropDragLimit(200, 200, 1.08);
    expect(oneNotchIn).toBeGreaterThan(fitted * 0.8);
    expect(oneNotchIn).toBeLessThan(fitted);
    expect(cropDragLimit(200, 200, 2.4)).toBeCloseTo(140);
  });

  it("has no drag-bound jump across the transition to cover-only movement", () => {
    const before = cropDragLimit(300, 300, 1.999);
    const at = cropDragLimit(300, 300, 2);
    const after = cropDragLimit(300, 300, 2.001);
    expect(before).toBeCloseTo(149.85);
    expect(at).toBe(150);
    expect(after).toBeCloseTo(150.15);
    expect(Math.abs(before - at)).toBeLessThan(0.2);
    for (const zoom of [1.999, 2, 2.001]) {
      expect(
        clampCropPoint(
          { x: 90, y: 70 },
          { width: 300, height: 300 },
          { width: 300, height: 300 },
          zoom,
        ),
      ).toEqual({ x: 90, y: 70 });
    }
  });

  it("always keeps cover-fit travel while extra padding room fades out", () => {
    for (const zoom of [1, 1.01, 1.25, 1.49, 1.5, 1.51, 1.9, 2, 2.5, 3]) {
      const coverSlack = (300 * zoom - 300) / 2;
      expect(cropDragLimit(300, 300, zoom)).toBeGreaterThanOrEqual(coverSlack);
    }
  });

  it("keeps a zoomed-in image covering the frame", () => {
    // zoom 2 on a fitted image: cover slack is 100, which is the whole limit.
    expect(cropDragLimit(200, 200, 2)).toBe(100);
    expect(clampCropPoint({ x: 80, y: 10 }, square, square, 2)).toEqual({ x: 80, y: 10 });
    expect(clampCropPoint({ x: 140, y: 0 }, square, square, 2)).toEqual({ x: 100, y: 0 });
  });

  it("does not pin a zoomed-out image to one edge the way a negative clamp does", () => {
    // Library: max = (200 * 0.5) / 2 - 100 = -50, and clamp(30, 50, -50) is -50.
    const libraryMax = (200 * 0.5) / 2 - 200 / 2;
    const libraryPinned = Math.min(Math.max(30, -libraryMax), libraryMax);
    expect(libraryPinned).toBe(-50);
    expect(clampCropPoint({ x: 30, y: 0 }, square, square, 0.5).x).toBe(30);
  });
});

describe("crop export placement", () => {
  it("draws a crop that sits inside the image at the origin of the output", () => {
    expect(
      placeCropOnImage({ x: 10, y: 20, width: 100, height: 80 }, { width: 400, height: 300 }),
    ).toEqual({
      source: { x: 10, y: 20, width: 100, height: 80 },
      destination: { x: 0, y: 0, width: 100, height: 80 },
    });
  });

  it("leaves padding when a zoomed-out image has been dragged", () => {
    const placed = placeCropOnImage(
      { x: -40, y: 10, width: 200, height: 200 },
      { width: 200, height: 200 },
    );
    expect(placed).toEqual({
      source: { x: 0, y: 10, width: 160, height: 190 },
      destination: { x: 40, y: 0, width: 160, height: 190 },
    });
  });
});
