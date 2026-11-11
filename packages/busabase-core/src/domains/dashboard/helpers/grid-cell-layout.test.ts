import { describe, expect, it } from "vitest";
import { FIELD_TYPE_ORDER } from "../../base/field-types";
import {
  buildGridCellText,
  GRID_FIELD_PRESENTATION,
  gridCollectionLayout,
  gridTextLines,
} from "./grid-cell-layout";

describe("grid cell density layout", () => {
  it("makes an explicit presentation decision for every registered field type", () => {
    expect(Object.keys(GRID_FIELD_PRESENTATION).sort()).toEqual([...FIELD_TYPE_ORDER].sort());
  });

  it("gives taller rows more complete text lines", () => {
    expect([32, 48, 96, 144].map(gridTextLines)).toEqual([1, 2, 4, 6]);
  });

  it("preserves authored line breaks while bounding work and detecting truncation", () => {
    expect(buildGridCellText("one\r\ntwo\rthree\tfour").text).toBe("one\ntwo\nthree  four");
    const preview = buildGridCellText(`start\n${"x".repeat(10000)}`);
    expect(preview.text).toHaveLength(240);
    expect(preview.truncated).toBe(true);
    expect(preview.text.startsWith("start\n")).toBe(true);
    expect(buildGridCellText(null).text).toBe("");
  });

  it("reserves a recoverable overflow action instead of clipping partial items", () => {
    expect(gridCollectionLayout(92, 32, [60, 60, 60])).toMatchObject({ visible: 0, hidden: 3 });
    const medium = gridCollectionLayout(190, 48, [70, 70, 70, 70, 70]);
    const tall = gridCollectionLayout(190, 96, [70, 70, 70, 70, 70]);
    expect(medium.visible).toBe(2);
    expect(medium.hidden).toBe(3);
    expect(tall.visible).toBe(5);
    expect(tall.hidden).toBe(0);
  });

  it("fits a complete collection even when reserving an unnecessary overflow would fail", () => {
    expect(gridCollectionLayout(70, 32, [60, 1])).toMatchObject({ visible: 2, hidden: 0 });
  });

  it("handles empty collections and narrow columns without negative budgets", () => {
    expect(gridCollectionLayout(12, 32, [60, 60])).toMatchObject({ visible: 0, hidden: 2 });
    expect(gridCollectionLayout(92, 144, [])).toMatchObject({ visible: 0, hidden: 0 });
  });
});
