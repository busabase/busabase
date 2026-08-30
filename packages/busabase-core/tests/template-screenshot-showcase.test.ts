import { describe, expect, it } from "vitest";
import { isScreenshotQuarterTurn } from "../src/domains/templates/components/template-detail-image";
import {
  adjustScreenshotZoom,
  clampScreenshotIndex,
  clampScreenshotZoom,
  getScreenshotDownloadName,
  rotateScreenshotClockwise,
} from "../src/domains/templates/components/template-screenshot-showcase";

describe("clampScreenshotIndex", () => {
  it("keeps screenshot navigation inside the available range", () => {
    expect(clampScreenshotIndex(-1, 2)).toBe(0);
    expect(clampScreenshotIndex(1, 2)).toBe(1);
    expect(clampScreenshotIndex(2, 2)).toBe(1);
    expect(clampScreenshotIndex(0, 0)).toBe(0);
  });
});

describe("template screenshot preview tools", () => {
  it("clamps zoom between 50% and 300%", () => {
    expect(clampScreenshotZoom(25)).toBe(50);
    expect(clampScreenshotZoom(125)).toBe(125);
    expect(clampScreenshotZoom(325)).toBe(300);
  });

  it("adjusts zoom in 25% steps without crossing its bounds", () => {
    expect(adjustScreenshotZoom(100, 1)).toBe(125);
    expect(adjustScreenshotZoom(50, -1)).toBe(50);
    expect(adjustScreenshotZoom(300, 1)).toBe(300);
  });

  it("rotates clockwise in 90 degree steps", () => {
    expect(rotateScreenshotClockwise(0)).toBe(90);
    expect(rotateScreenshotClockwise(270)).toBe(0);
  });

  it("swaps fit constraints for quarter turns", () => {
    expect(isScreenshotQuarterTurn(0)).toBe(false);
    expect(isScreenshotQuarterTurn(90)).toBe(true);
    expect(isScreenshotQuarterTurn(180)).toBe(false);
    expect(isScreenshotQuarterTurn(270)).toBe(true);
  });

  it("keeps a remote filename and falls back for malformed URLs", () => {
    expect(getScreenshotDownloadName("https://example.com/gallery/CRM%20Overview.png?v=2", 0)).toBe(
      "CRM Overview.png",
    );
    expect(getScreenshotDownloadName("not a valid URL", 2)).toBe("template-screenshot-3.png");
  });
});
