import { describe, expect, it } from "vitest";
import { PackageViewConfigSchema } from "../../package/types";
import { GRID_ROW_HEIGHTS, type GridRowHeight, getGridRowHeight } from "../types";
import {
  createViewInputSchema,
  updateViewInputSchema,
  viewChangeRequestInputSchema,
  viewConfigSchema,
} from "./view-schemas";

describe("saved grid row-height contract", () => {
  it.each(Object.entries(GRID_ROW_HEIGHTS))(
    "accepts %s across create, patch, operation, and portable config",
    (rowHeight, pixels) => {
      expect(getGridRowHeight(rowHeight)).toBe(pixels);
      expect(viewConfigSchema.parse({ rowHeight }).rowHeight).toBe(rowHeight);
      expect(
        createViewInputSchema.parse({ name: "Grid", config: { rowHeight } }).config,
      ).toMatchObject({ rowHeight });
      expect(updateViewInputSchema.parse({ config: { rowHeight } }).config).toEqual({
        rowHeight,
      });
      const operation = viewChangeRequestInputSchema.parse({
        operation: "update",
        viewId: "view_density",
        config: { rowHeight },
      });
      if (operation.operation !== "update") throw new Error("Expected an update operation");
      expect(operation.config).toEqual({ rowHeight });
      expect(PackageViewConfigSchema.parse({ rowHeight }).rowHeight).toBe(rowHeight);
    },
  );

  it.each(["auto", "extraTall", "", "__proto__", "constructor", 96, null, {}, []])(
    "rejects invalid row height %j instead of losing it silently",
    (rowHeight) => {
      expect(viewConfigSchema.safeParse({ rowHeight }).success).toBe(false);
      expect(updateViewInputSchema.safeParse({ config: { rowHeight } }).success).toBe(false);
      expect(PackageViewConfigSchema.safeParse({ rowHeight }).success).toBe(false);
      expect(getGridRowHeight(rowHeight)).toBe(48);
    },
  );

  it("keeps legacy and unrelated patches free of a synthetic density edit", () => {
    expect(getGridRowHeight(undefined)).toBe(48);
    expect(Object.hasOwn(viewConfigSchema.parse({}), "rowHeight")).toBe(false);
    expect(Object.hasOwn(PackageViewConfigSchema.parse({}), "rowHeight")).toBe(false);
    expect(updateViewInputSchema.parse({ config: { fieldWidths: { title: 200 } } }).config).toEqual(
      { fieldWidths: { title: 200 } },
    );
    expect(Object.keys(GRID_ROW_HEIGHTS)).toEqual([
      "short",
      "medium",
      "tall",
      "extra-tall",
    ] satisfies GridRowHeight[]);
  });
});
