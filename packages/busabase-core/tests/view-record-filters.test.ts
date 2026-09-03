import type { BaseFieldVO, ViewConfigVO } from "busabase-contract/domains/base/types";
import { describe, expect, it } from "vitest";
import {
  applyViewConfigToEvaluableRecords,
  getViewFieldPreviewText,
} from "../src/domains/base/utils/view-records";

/**
 * A view filter's value and a record's value are formatted by the SAME
 * `getViewFieldPreviewText` before being compared (`recordMatchesViewFilter`).
 * For choice-backed fields the stored value is a choice ID while the compared
 * text is the choice's NAME, so both sides must complete that id → name step.
 * `multiselect` used to map only the record side (its case was guarded on
 * `Array.isArray`, which a single-id filter value never satisfies), leaving
 * equals/contains unable to match any record at all.
 */

const field = (
  slug: string,
  type: BaseFieldVO["type"],
  choices?: Array<{ id: string; name: string }>,
): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "bas_test",
  slug,
  name: slug,
  type,
  required: false,
  position: 0,
  options: choices ? { choices } : {},
});

const TAGS = field("tags", "multiselect", [
  { id: "opt_urgent", name: "Urgent" },
  { id: "opt_later", name: "Later" },
]);
const STATUS = field("status", "select", [
  { id: "opt_open", name: "Open" },
  { id: "opt_done", name: "Done" },
]);

const rows = [
  {
    id: "r1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fields: { tags: ["opt_urgent"], status: "opt_open" },
  },
  {
    id: "r2",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fields: { tags: ["opt_later", "opt_urgent"], status: "opt_done" },
  },
  { id: "r3", updatedAt: "2026-01-01T00:00:00.000Z", fields: {} },
];

const filterBy = (
  fields: BaseFieldVO[],
  fieldSlug: string,
  operator: ViewConfigVO["filters"][number]["operator"],
  value?: unknown,
): string[] => {
  const config: ViewConfigVO = { filters: [{ fieldSlug, operator, value }], sorts: [] };
  // Sorted: these cases assert WHICH records survive the filter, not the order
  // the (empty) sort config leaves them in.
  return applyViewConfigToEvaluableRecords(rows, fields, config)
    .map((row) => row.id)
    .sort();
};

describe("view filter preview-text parity for choice fields", () => {
  it("maps a single choice id to its label on BOTH sides (multiselect)", () => {
    // The filter value the view editor writes is one choice id, not an array.
    expect(getViewFieldPreviewText(TAGS, "opt_urgent")).toBe("Urgent");
    expect(getViewFieldPreviewText(TAGS, ["opt_later", "opt_urgent"])).toBe("Later, Urgent");
  });

  it("multiselect contains matches every record carrying that choice", () => {
    expect(filterBy([TAGS], "tags", "contains", "opt_urgent")).toEqual(["r1", "r2"]);
    expect(filterBy([TAGS], "tags", "contains", "opt_later")).toEqual(["r2"]);
  });

  it("multiselect equals matches a record whose only choice is that one", () => {
    // equals compares the whole rendered text, so r2 ("Later, Urgent") is out.
    expect(filterBy([TAGS], "tags", "equals", "opt_urgent")).toEqual(["r1"]);
  });

  it("multiselect empty/not_empty still separate unset records", () => {
    expect(filterBy([TAGS], "tags", "not_empty")).toEqual(["r1", "r2"]);
    expect(filterBy([TAGS], "tags", "is_empty")).toEqual(["r3"]);
  });

  it("select keeps matching by label (unchanged behaviour)", () => {
    expect(filterBy([STATUS], "status", "equals", "opt_open")).toEqual(["r1"]);
    expect(filterBy([STATUS], "status", "is_empty")).toEqual(["r3"]);
  });

  it("an unknown choice id falls back to the raw id rather than matching all", () => {
    expect(getViewFieldPreviewText(TAGS, "opt_gone")).toBe("opt_gone");
    expect(filterBy([TAGS], "tags", "equals", "opt_gone")).toEqual([]);
  });
});
