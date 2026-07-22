import { describe, expect, it } from "vitest";
import { viewConfigSchema } from "./view-schemas";

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
