import { describe, expect, it } from "vitest";
import { updateViewInputSchema, viewConfigSchema } from "./view-schemas";

describe("viewConfigSchema field widths", () => {
  it("accepts integer pixel widths inside the supported range", () => {
    expect(
      viewConfigSchema.parse({ filters: [], sorts: [], fieldWidths: { title: 240 } }).fieldWidths,
    ).toEqual({ title: 240 });
  });

  it.each([91, 641, 240.5])("rejects an unsupported field width of %s", (width) => {
    expect(() =>
      viewConfigSchema.parse({ filters: [], sorts: [], fieldWidths: { title: width } }),
    ).toThrow();
  });
});

describe("updateViewInputSchema config patch", () => {
  it("does not add omitted filters or sorts", () => {
    expect(
      updateViewInputSchema.parse({ config: { visibleFieldSlugs: ["title"] } }).config,
    ).toEqual({
      visibleFieldSlugs: ["title"],
    });
  });

  it("preserves explicit empty arrays for clearing filters or sorts", () => {
    expect(updateViewInputSchema.parse({ config: { filters: [], sorts: [] } }).config).toEqual({
      filters: [],
      sorts: [],
    });
  });
});
