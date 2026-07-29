import { describe, expect, it } from "vitest";
import { recordGetInputSchema } from "./record-schemas";

describe("recordGetInputSchema", () => {
  it("accepts either record id or exact field selector", () => {
    expect(recordGetInputSchema.parse({ recordId: "rec_1" })).toEqual({ recordId: "rec_1" });
    expect(
      recordGetInputSchema.parse({ baseId: "bse_1", fieldSlug: "slug", valueText: "hello" }),
    ).toEqual({ baseId: "bse_1", fieldSlug: "slug", valueText: "hello" });
  });

  it("rejects neither selector and both selectors", () => {
    expect(recordGetInputSchema.safeParse({}).success).toBe(false);
    expect(
      recordGetInputSchema.safeParse({
        recordId: "rec_1",
        baseId: "bse_1",
        fieldSlug: "slug",
        valueText: "hello",
      }).success,
    ).toBe(false);
  });
});
