import { describe, expect, it } from "vitest";
import { combineViewFilters, flattenViewFilters } from "../../../types";
import { PackageViewConfigSchema } from "../../package/types";
import { createViewInputSchema, updateViewInputSchema, viewConfigSchema } from "./view-schemas";

const leaf = {
  fieldSlug: "status",
  fieldId: "source-field",
  operator: "equals" as const,
  value: "pending",
};
const group = { conjunction: "or" as const, conditions: [leaf, { ...leaf, value: "in-progress" }] };

describe("saved view boolean contract", () => {
  it("preserves root conjunction and nested rules through create/update parsing", () => {
    const config = { filters: [leaf, group], filterConjunction: "and" as const, sorts: [] };
    expect(createViewInputSchema.parse({ name: "My active tasks", config }).config).toEqual(config);
    expect(
      updateViewInputSchema.parse({ config: { filters: [group], filterConjunction: "or" } }).config,
    ).toEqual({ filters: [group], filterConjunction: "or" });
    expect(updateViewInputSchema.parse({ config: { filterConjunction: "or" } }).config).toEqual({
      filterConjunction: "or",
    });
  });
  it("rejects empty groups, more than 3 levels, and more than 100 total rules", () => {
    expect(
      viewConfigSchema.safeParse({ filters: [{ conjunction: "and", conditions: [] }] }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({
        filters: [{ conjunction: "and", conditions: [{ conjunction: "or", conditions: [group] }] }],
      }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({ filters: Array.from({ length: 51 }, () => group) }).success,
    ).toBe(false);
    expect(
      viewConfigSchema.safeParse({
        filters: [{ conjunction: "and", conditions: [{ conjunction: "or", conditions: [leaf] }] }],
      }).success,
    ).toBe(true);
  });
  it("exports portable nested rules without source field IDs", () => {
    const result = PackageViewConfigSchema.parse({ filters: [group], filterConjunction: "or" });
    expect(result.filterConjunction).toBe("or");
    expect(flattenViewFilters(result.filters).map((rule) => rule.fieldId)).toEqual([
      undefined,
      undefined,
    ]);
    expect(viewConfigSchema.parse(result)).toEqual(result);
  });
  it("ANDs ad-hoc filters around the complete saved OR expression", () => {
    expect(combineViewFilters({ filters: [leaf, group], filterConjunction: "or" }, [leaf])).toEqual(
      [{ conjunction: "or", conditions: [leaf, group] }, leaf],
    );
    expect(combineViewFilters({ filters: [leaf] })).toEqual([leaf]);
  });
});
