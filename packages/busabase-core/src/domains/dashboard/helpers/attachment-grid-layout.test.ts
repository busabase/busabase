import { describe, expect, it } from "vitest";
import { attachmentGridLayout, attachmentGridThumbnailSize } from "./attachment-grid-layout";

describe("attachment grid width budget", () => {
  it("limits collapsed previews while reserving the complete hidden count", () => {
    expect(attachmentGridLayout(500, [32, 32, 32], 1)).toMatchObject({ visible: 1, hidden: 2 });
    expect(attachmentGridLayout(70, [32, 32, 32], 1)).toMatchObject({ visible: 0, hidden: 3 });
  });
  it("fits complete images and reserves overflow even with only two files", () => {
    expect(attachmentGridLayout(100, [32, 32]).visible).toBe(2);
    expect(attachmentGridLayout(99, [32, 32])).toMatchObject({ visible: 0, hidden: 2 });
    expect(attachmentGridLayout(195, [32, 128])).toMatchObject({ visible: 1, hidden: 1 });
    expect(attachmentGridLayout(69, [128, 32])).toMatchObject({ visible: 0, hidden: 2 });
    expect(attachmentGridLayout(196, [128, 32])).toMatchObject({ visible: 2, hidden: 0 });
  });
  it("keeps original order, fills wide cells, and accounts for multi-digit counters", () => {
    expect(attachmentGridLayout(234, [32, 128, 32, 32])).toMatchObject({ visible: 2, hidden: 2 });
    expect(attachmentGridLayout(233, [32, 128, 32, 32])).toMatchObject({ visible: 1, hidden: 3 });
    expect(attachmentGridLayout(1000, [32, 32, 32, 32])).toMatchObject({ visible: 4, hidden: 0 });
    expect(attachmentGridLayout(100, Array(26).fill(32))).toMatchObject({ visible: 1, hidden: 25 });
    expect(attachmentGridLayout(108, Array(101).fill(32))).toMatchObject({
      visible: 1,
      hidden: 100,
      overflowWidth: 40,
    });
    expect(attachmentGridLayout(0, [32, 32])).toMatchObject({ visible: 0, hidden: 2 });
    expect(attachmentGridLayout(100, [])).toMatchObject({ visible: 0, hidden: 0 });
  });
  it("combines expansion with the full count when separate controls would not fit", () => {
    expect(attachmentGridLayout(30, [32, 32])).toMatchObject({
      visible: 0,
      hidden: 2,
      combinedControls: true,
    });
    expect(attachmentGridLayout(64, Array(100).fill(32))).toMatchObject({
      visible: 0,
      hidden: 100,
      combinedControls: true,
      overflowWidth: 40,
    });
    expect(attachmentGridLayout(70, Array(100).fill(32)).combinedControls).toBe(false);
  });
  it("sizes previews by row height while preserving space for narrow-cell controls", () => {
    expect([32, 48, 96, 144].map((height) => attachmentGridThumbnailSize(height, 500, 12))).toEqual(
      [24, 32, 80, 128],
    );
    expect(attachmentGridThumbnailSize(144, 110, 12)).toBe(42);
    expect(attachmentGridLayout(110, Array(12).fill(42))).toMatchObject({ visible: 1, hidden: 11 });
    expect(attachmentGridThumbnailSize(144, 70, 12)).toBe(24);
    expect(attachmentGridThumbnailSize(144, 110, 1)).toBe(80);
  });
});
