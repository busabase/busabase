import { describe, expect, it } from "vitest";
import { listRecordsInputSchema, recordGetInputSchema } from "./record-schemas";

describe("listRecordsInputSchema", () => {
  it("keeps full records by default and accepts an explicit summary option", () => {
    expect(listRecordsInputSchema.parse({ baseId: "bse_1" }).summary).toBeUndefined();
    expect(listRecordsInputSchema.parse({ baseId: "bse_1", summary: true }).summary).toBe(true);
    expect(listRecordsInputSchema.parse({ baseId: "bse_1", summary: false }).summary).toBe(false);
    expect(listRecordsInputSchema.parse({ baseId: "bse_1", summary: "true" }).summary).toBe(true);
    expect(listRecordsInputSchema.parse({ baseId: "bse_1", summary: "false" }).summary).toBe(false);
  });
});

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
