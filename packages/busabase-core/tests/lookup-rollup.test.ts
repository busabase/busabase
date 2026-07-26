import { describe, expect, it } from "vitest";
import { FIELD_TYPES, isSystemFieldType } from "../src/domains/base/field-types";
import {
  applyRollup,
  isRollupCompatible,
  LOOKUP_ROLLUPS,
  lookupValueKind,
  rollupPreservesTargetUnit,
} from "../src/domains/base/lookup/rollup";

describe("applyRollup", () => {
  it("brings linked values over as a flat array for `values`", () => {
    expect(applyRollup(["Widget", "Gadget"], "values")).toEqual(["Widget", "Gadget"]);
  });

  it("flattens one level so an array-valued target (multiselect) stays scalar", () => {
    expect(applyRollup([["a", "b"], ["c"]], "values")).toEqual(["a", "b", "c"]);
  });

  it("drops null/undefined holes — an unset field on a linked record is not a value", () => {
    expect(applyRollup(["Widget", null, undefined, "Gadget"], "values")).toEqual([
      "Widget",
      "Gadget",
    ]);
    expect(applyRollup(["Widget", null, undefined], "count")).toBe(1);
  });

  it("aggregates numbers", () => {
    const prices = [10, 25, 5];
    expect(applyRollup(prices, "sum")).toBe(40);
    expect(applyRollup(prices, "average")).toBe(40 / 3);
    expect(applyRollup(prices, "min")).toBe(5);
    expect(applyRollup(prices, "max")).toBe(25);
    expect(applyRollup(prices, "count")).toBe(3);
  });

  it("coerces numeric strings, which is how numbers survive a jsonb round-trip", () => {
    expect(applyRollup(["10", "32"], "sum")).toBe(42);
  });

  it("ignores non-numeric entries in a numeric rollup rather than producing NaN", () => {
    expect(applyRollup([10, "n/a", 32], "sum")).toBe(42);
    expect(applyRollup([10, "n/a", 32], "count")).toBe(3);
  });

  it("joins with `concatenate`", () => {
    expect(applyRollup(["Widget", "Gadget"], "concatenate")).toBe("Widget, Gadget");
    expect(applyRollup([1, true], "concatenate")).toBe("1, true");
  });

  // The empty case is the one most likely to be got wrong: COUNT over nothing is
  // 0, but SUM over nothing is unknown, not 0 — a record with no links must not
  // read as "total: $0" when the truth is "nothing linked yet".
  it("returns 0 for count and null for the other aggregates when nothing is linked", () => {
    expect(applyRollup([], "values")).toEqual([]);
    expect(applyRollup([], "count")).toBe(0);
    expect(applyRollup([], "concatenate")).toBe("");
    for (const rollup of ["sum", "average", "min", "max"] as const) {
      expect(applyRollup([], rollup)).toBeNull();
    }
  });

  it("returns null for a numeric rollup over values that are all non-numeric", () => {
    expect(applyRollup(["a", "b"], "sum")).toBeNull();
  });
});

describe("isRollupCompatible", () => {
  it("allows values/count/concatenate against any target field type", () => {
    for (const rollup of ["values", "count", "concatenate"] as const) {
      expect(isRollupCompatible(rollup, "text")).toBe(true);
      expect(isRollupCompatible(rollup, "number")).toBe(true);
      expect(isRollupCompatible(rollup, "attachment")).toBe(true);
    }
  });

  it("restricts sum/average/min/max to numeric targets", () => {
    for (const rollup of ["sum", "average", "min", "max"] as const) {
      expect(isRollupCompatible(rollup, "number")).toBe(true);
      expect(isRollupCompatible(rollup, "auto_number")).toBe(true);
      // A formula's runtime type isn't known statically — allowed, rolls up to
      // null if it turns out non-numeric.
      expect(isRollupCompatible(rollup, "formula")).toBe(true);
      expect(isRollupCompatible(rollup, "text")).toBe(false);
      expect(isRollupCompatible(rollup, "checkbox")).toBe(false);
    }
  });
});

describe("lookup field registration", () => {
  it("is read-only everywhere — stripped from input, hidden on create", () => {
    expect(isSystemFieldType("lookup")).toBe(true);
    expect(FIELD_TYPES.lookup.input).toBe("computed");
  });

  it("has NO compute hook — it resolves at read time, not write time", () => {
    // The whole design hinges on this: a compute hook would bake a value into
    // the commit that goes stale the moment a linked record changes.
    expect(FIELD_TYPES.lookup.compute).toBeUndefined();
    expect(FIELD_TYPES.lookup.readOnly).toBe(true);
  });

  it("declares a value kind for every rollup", () => {
    expect(LOOKUP_ROLLUPS.map(lookupValueKind)).toEqual([
      "array",
      "number",
      "number",
      "number",
      "number",
      "number",
      "string",
    ]);
  });
});

describe("rollupPreservesTargetUnit", () => {
  // Decides whether the lookup inherits the target field's currency/locale
  // formatting. Getting `count` wrong here would render a row tally as money.
  it("keeps the target's unit for values/sum/average/min/max", () => {
    for (const rollup of ["values", "sum", "average", "min", "max"] as const) {
      expect(rollupPreservesTargetUnit(rollup)).toBe(true);
    }
  });

  it("drops it for count (a tally, not money) and concatenate (already text)", () => {
    expect(rollupPreservesTargetUnit("count")).toBe(false);
    expect(rollupPreservesTargetUnit("concatenate")).toBe(false);
  });
});
