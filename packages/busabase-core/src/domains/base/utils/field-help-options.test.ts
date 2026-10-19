import { describe, expect, it } from "vitest";
import { mergeFieldHelpOptions } from "./field-help-options";

describe("merging field guidance", () => {
  const current = {
    date: { includeTime: true, timezone: "Asia/Shanghai" },
    help: { description: "Actual completion date", example: "2026-10-14" },
  };

  it("applies guidance against live options without mutating them", () => {
    const result = mergeFieldHelpOptions(current, undefined, {
      description: "Customer acceptance",
    });
    expect(result.date).toEqual(current.date);
    expect(result.help).toEqual({ description: "Customer acceptance" });
    expect(current.help.description).toBe("Actual completion date");
  });

  it("retains current guidance when type-specific settings are replaced", () => {
    const replacement = { date: { includeTime: false, timezone: "UTC" } };
    expect(mergeFieldHelpOptions(current, replacement, undefined)).toEqual({
      ...replacement,
      help: current.help,
    });
  });

  it("distinguishes missing help, supplied help, and removal", () => {
    expect(mergeFieldHelpOptions(current, undefined, undefined)).toEqual(current);
    expect(mergeFieldHelpOptions(current, undefined, null)).toEqual({ date: current.date });
    expect(
      mergeFieldHelpOptions(current, { ...current, help: { example: "New" } }, undefined).help,
    ).toEqual({ example: "New" });
  });
});
