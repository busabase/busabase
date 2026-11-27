import { describe, expect, it } from "vitest";
import { PackageViewConfigSchema } from "../../package/types";
import {
  ALWAYS_SET_FIELD_TYPES,
  GROUPABLE_FIELD_TYPES,
  getViewSummaryFunctions,
  isViewSummaryFunctionAllowed,
  NUMERIC_AGGREGATE_FIELD_TYPES,
  VIEW_GROUP_MAX_LEVELS,
  VIEW_SUMMARY_FUNCTIONS,
} from "../types";
import { groupRecordsInputSchema, listRecordsPageInputSchema } from "./record-schemas";
import {
  createViewInputSchema,
  updateViewInputSchema,
  viewChangeRequestInputSchema,
  viewConfigSchema,
} from "./view-schemas";

describe("table grouping config", () => {
  it("accepts one level across create, patch, operation and portable config", () => {
    const groupBy = [{ fieldSlug: "status", fieldId: "fld_status", direction: "desc" as const }];
    expect(viewConfigSchema.parse({ groupBy }).groupBy).toEqual(groupBy);
    expect(createViewInputSchema.parse({ name: "Grid", config: { groupBy } }).config).toMatchObject(
      {
        groupBy,
      },
    );
    expect(updateViewInputSchema.parse({ config: { groupBy } }).config).toEqual({ groupBy });
    const operation = viewChangeRequestInputSchema.parse({
      operation: "update",
      viewId: "view_grouped",
      config: { groupBy },
    });
    if (operation.operation !== "update") throw new Error("Expected an update operation");
    expect(operation.config).toEqual({ groupBy });
    // Portable packages drop the server-populated id; slugs survive re-id'ing.
    expect(PackageViewConfigSchema.parse({ groupBy }).groupBy).toEqual([
      { fieldSlug: "status", direction: "desc" },
    ]);
  });

  it("defaults the direction and clears with an empty array", () => {
    expect(viewConfigSchema.parse({ groupBy: [{ fieldSlug: "status" }] }).groupBy).toEqual([
      { fieldSlug: "status", direction: "asc" },
    ]);
    expect(updateViewInputSchema.parse({ config: { groupBy: [] } }).config).toEqual({
      groupBy: [],
    });
  });

  it(`rejects more than ${VIEW_GROUP_MAX_LEVELS} level and malformed levels`, () => {
    expect(VIEW_GROUP_MAX_LEVELS).toBe(1);
    const twoLevels = [{ fieldSlug: "status" }, { fieldSlug: "done" }];
    expect(viewConfigSchema.safeParse({ groupBy: twoLevels }).success).toBe(false);
    expect(updateViewInputSchema.safeParse({ config: { groupBy: twoLevels } }).success).toBe(false);
    expect(PackageViewConfigSchema.safeParse({ groupBy: twoLevels }).success).toBe(false);
    for (const groupBy of [
      [{ fieldSlug: "" }],
      [{ fieldSlug: "status", direction: "up" }],
      [{ direction: "asc" }],
      "status",
      { fieldSlug: "status" },
    ]) {
      expect(viewConfigSchema.safeParse({ groupBy }).success).toBe(false);
    }
  });

  it("keeps unrelated patches free of a synthetic grouping edit", () => {
    expect(Object.hasOwn(viewConfigSchema.parse({}), "groupBy")).toBe(false);
    expect(Object.hasOwn(viewConfigSchema.parse({}), "fieldSummaries")).toBe(false);
    expect(updateViewInputSchema.parse({ config: { rowHeight: "tall" } }).config).toEqual({
      rowHeight: "tall",
    });
  });

  it("groups only by select and checkbox", () => {
    expect([...GROUPABLE_FIELD_TYPES]).toEqual(["select", "checkbox"]);
  });
});

describe("column summary config", () => {
  it("accepts every function in view, patch and portable config", () => {
    const fieldSummaries = Object.fromEntries(
      VIEW_SUMMARY_FUNCTIONS.map((fn, index) => [`field_${index}`, fn]),
    );
    expect(viewConfigSchema.parse({ fieldSummaries }).fieldSummaries).toEqual(fieldSummaries);
    expect(updateViewInputSchema.parse({ config: { fieldSummaries } }).config).toEqual({
      fieldSummaries,
    });
    expect(PackageViewConfigSchema.parse({ fieldSummaries }).fieldSummaries).toEqual(
      fieldSummaries,
    );
  });

  it.each(["median", "count", "", null, 3, "SUM"])("rejects unknown function %j", (fn) => {
    expect(viewConfigSchema.safeParse({ fieldSummaries: { amount: fn } }).success).toBe(false);
    expect(
      updateViewInputSchema.safeParse({ config: { fieldSummaries: { amount: fn } } }).success,
    ).toBe(false);
    expect(PackageViewConfigSchema.safeParse({ fieldSummaries: { amount: fn } }).success).toBe(
      false,
    );
  });

  it("offers numeric functions only for number-shaped fields", () => {
    expect([...NUMERIC_AGGREGATE_FIELD_TYPES]).toEqual(["number", "auto_number"]);
    expect(getViewSummaryFunctions("number")).toEqual([
      "sum",
      "avg",
      "min",
      "max",
      "filled",
      "empty",
      "percent_filled",
    ]);
    for (const type of ["text", "select", "multiselect", "relation", "lookup", "date"]) {
      expect(getViewSummaryFunctions(type)).toEqual(["filled", "empty", "percent_filled"]);
    }
    // The write-time check the server applies per supplied summary.
    expect(isViewSummaryFunctionAllowed("number", "sum")).toBe(true);
    expect(isViewSummaryFunctionAllowed("text", "sum")).toBe(false);
    expect(isViewSummaryFunctionAllowed("text", "avg")).toBe(false);
    expect(isViewSummaryFunctionAllowed("text", "filled")).toBe(true);
    expect(isViewSummaryFunctionAllowed("number", "median")).toBe(false);
  });

  it("counts checked boxes on a checkbox instead of filled values", () => {
    // An unchecked box is still a value, so "filled" would always read 100%.
    expect(getViewSummaryFunctions("checkbox")).toEqual([
      "checked",
      "unchecked",
      "percent_checked",
    ]);
    for (const fn of ["filled", "empty", "percent_filled", "sum", "avg"]) {
      expect(isViewSummaryFunctionAllowed("checkbox", fn)).toBe(false);
    }
    for (const type of ["text", "number", "select", "auto_number"]) {
      for (const fn of ["checked", "unchecked", "percent_checked"]) {
        expect(isViewSummaryFunctionAllowed(type, fn)).toBe(false);
      }
    }
  });

  it("offers no filled family on always-set system fields; auto numbers keep the math", () => {
    expect([...ALWAYS_SET_FIELD_TYPES].sort()).toEqual(
      ["auto_number", "created_by", "created_time", "updated_by", "updated_time"].sort(),
    );
    expect(getViewSummaryFunctions("auto_number")).toEqual(["sum", "avg", "min", "max"]);
    for (const type of ["created_time", "updated_time", "created_by", "updated_by"]) {
      expect(getViewSummaryFunctions(type)).toEqual([]);
      expect(isViewSummaryFunctionAllowed(type, "filled")).toBe(false);
    }
    expect(isViewSummaryFunctionAllowed("auto_number", "percent_filled")).toBe(false);
    expect(isViewSummaryFunctionAllowed("auto_number", "max")).toBe(true);
  });
});

describe("records.groupBy input", () => {
  it("accepts the filled aggregate on any field and the listPage find shape", () => {
    const parsed = groupRecordsInputSchema.parse({
      baseId: "base",
      aggregates: [
        { fn: "filled", fieldSlug: "title" },
        { fn: "sum", fieldSlug: "amount" },
        { fn: "checked", fieldSlug: "done" },
      ],
      find: { query: "  acme  ", fieldId: "fld_title" },
    });
    expect(parsed.aggregates).toHaveLength(3);
    // Same trimming as records.listPage, so both read the same search.
    expect(parsed.find).toEqual(
      listRecordsPageInputSchema.parse({
        baseId: "base",
        find: { query: "  acme  ", fieldId: "fld_title" },
      }).find,
    );
  });

  it("rejects unknown aggregates and an empty find", () => {
    expect(
      groupRecordsInputSchema.safeParse({
        baseId: "base",
        aggregates: [{ fn: "empty", fieldSlug: "title" }],
      }).success,
    ).toBe(false);
    expect(
      groupRecordsInputSchema.safeParse({ baseId: "base", find: { query: "  " } }).success,
    ).toBe(false);
  });
});
