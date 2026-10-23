import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { applyRollup } from "../../base/lookup/rollup";
import { getFetchableRelationRecordIds } from "./field";
import { emptyLookupValues, lookupDisplayField, lookupItemValue, sameLookupConfig } from "./lookup";

const target = {
  id: "money",
  baseId: "courses",
  slug: "price",
  name: "Price",
  type: "number",
  required: false,
  position: 1,
  options: { number: { format: "currency", currency: "EUR" } },
} as BaseFieldVO;

describe("lookup presentation helpers", () => {
  it("preserves legacy flattened count including empty strings", () => {
    expect(applyRollup(["", null, [1, 2]], "count")).toBe(3);
  });
  it("inherits current target formatting without formatting counts as currency", () => {
    expect(lookupDisplayField(target, "values")).toBe(target);
    for (const rollup of ["sum", "average", "min", "max"] as const)
      expect(lookupDisplayField(target, rollup).options.number?.currency).toBe("EUR");
    expect(lookupDisplayField(target, "count")).toMatchObject({ type: "number", options: {} });
    expect(lookupDisplayField(target, "concatenate")).toMatchObject({ type: "text", options: {} });
  });
  it("restores array containers required by typed scalar lookup values", () => {
    for (const type of ["member", "multiselect", "attachment", "relation", "ai_tags"] as const)
      expect(lookupItemValue({ ...target, type }, "value")).toEqual(["value"]);
    expect(lookupItemValue({ ...target, type: "date" }, "2026-10-12")).toBe("2026-10-12");
  });
  it("keeps zero and false as real source values", () => {
    expect(emptyLookupValues([null, undefined, "", []])).toBe(true);
    expect(emptyLookupValues([0])).toBe(false);
    expect(emptyLookupValues([false])).toBe(false);
  });
  it("does not submit a configuration change for equivalent defaults", () => {
    const config = { relationFieldSlug: "courses", targetFieldSlug: "price" };
    expect(sameLookupConfig(config, { ...config, rollup: "values", limit: "all" })).toBe(true);
    expect(sameLookupConfig({ ...config, limit: "first" }, { ...config, rollup: "sum" })).toBe(
      false,
    );
  });
  it("only fetches relations to visible bases, preserving order and deduplicating", () => {
    const record = {
      base: {
        fields: [
          { slug: "visible", type: "relation", options: { targetBaseId: "public" } },
          { slug: "hidden", type: "relation", options: { targetBaseId: "private" } },
          { slug: "legacy", type: "relation", options: {} },
        ],
      },
      headCommit: {
        payload: { visible: ["rec1", "rec2", "rec1"], hidden: ["secret"], legacy: "rec3" },
      },
    } as unknown as RecordVO;
    expect(getFetchableRelationRecordIds([record], new Set(["public"]))).toEqual([
      "rec1",
      "rec2",
      "rec3",
    ]);
  });
});
