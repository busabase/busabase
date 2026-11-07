import { describe, expect, it } from "vitest";
import { fieldChangeMatches } from "./trigger-filter";

describe("fieldChangeMatches", () => {
  it("without a target value, starts on any real change", () => {
    expect(fieldChangeMatches({ before: "Draft", after: "Ready", toValue: "" })).toBe(true);
    expect(fieldChangeMatches({ before: "Ready", after: "Ready", toValue: "" })).toBe(false);
    // Empty in any form is the same as empty.
    expect(fieldChangeMatches({ before: undefined, after: "", toValue: "" })).toBe(false);
    expect(fieldChangeMatches({ before: null, after: [], toValue: "" })).toBe(false);
    // A new record that fills the field counts as a change.
    expect(fieldChangeMatches({ before: undefined, after: "Ready", toValue: "" })).toBe(true);
  });

  it("with a target value, starts only when the field becomes it", () => {
    expect(fieldChangeMatches({ before: "Draft", after: "Ready", toValue: "Ready" })).toBe(true);
    // Already Ready and edited again: nothing.
    expect(fieldChangeMatches({ before: "Ready", after: "Ready", toValue: "Ready" })).toBe(false);
    // Changed, but to something else.
    expect(fieldChangeMatches({ before: "Draft", after: "Done", toValue: "Ready" })).toBe(false);
    // Created as Ready.
    expect(fieldChangeMatches({ before: undefined, after: "Ready", toValue: "Ready" })).toBe(true);
  });

  it("compares numbers, checkboxes, and multi-select choices as text", () => {
    expect(fieldChangeMatches({ before: false, after: true, toValue: "true" })).toBe(true);
    expect(fieldChangeMatches({ before: 3, after: 5, toValue: "5" })).toBe(true);
    expect(
      fieldChangeMatches({ before: ["opt_a"], after: ["opt_a", "opt_b"], toValue: "opt_b" }),
    ).toBe(true);
    expect(
      fieldChangeMatches({ before: ["opt_b"], after: ["opt_a", "opt_b"], toValue: "opt_b" }),
    ).toBe(false);
  });
});
