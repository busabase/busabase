import { describe, expect, it } from "vitest";
import { LOOKUP_SOURCE_LIMIT } from "../types";
import {
  listRecordsInputSchema,
  lookupComputedSchema,
  recordGetInputSchema,
} from "./record-schemas";

describe("lookupComputedSchema", () => {
  it("bounds provenance and round-trips truncation/read-start metadata", () => {
    const source = { recordId: "rec_1", title: "One", value: 1, headCommitId: "cmt_1" };
    const computed = {
      status: "ready",
      value: 26,
      dependencyVersion: "hash",
      sources: Array.from({ length: LOOKUP_SOURCE_LIMIT }, () => source),
      sourcesTruncated: true,
      dependencyReadAt: 123.456,
    };
    expect(lookupComputedSchema.parse(computed)).toEqual(computed);
    expect(
      lookupComputedSchema.safeParse({ ...computed, sources: [...computed.sources, source] })
        .success,
    ).toBe(false);
    expect(
      lookupComputedSchema.safeParse({ ...computed, dependencyReadAt: Infinity }).success,
    ).toBe(false);
  });

  it("accepts older responses without freshness or truncation metadata", () => {
    expect(
      lookupComputedSchema.parse({
        status: "empty",
        value: null,
        sources: [],
        dependencyVersion: "hash",
      }),
    ).toEqual({ status: "empty", value: null, sources: [], dependencyVersion: "hash" });
  });
});

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
