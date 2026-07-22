import type { BaseFieldVO, ViewConfigVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  clampViewFieldWidth,
  clearFirstViewFilter,
  clearViewSort,
  getVisibleViewFieldSlugs,
  hideViewField,
  matchesViewField,
  moveViewField,
  replaceFirstViewFilter,
  resetViewFieldWidth,
  setPrimaryViewSort,
  setViewFieldWidth,
} from "./view-config";

const field = { id: "fld_status", slug: "status" } as BaseFieldVO;
const fields = [{ slug: "title" }, { slug: "status" }, { slug: "owner" }] as BaseFieldVO[];
const config: ViewConfigVO = {
  filters: [
    { fieldSlug: "owner", operator: "equals", value: "kelly" },
    { fieldId: field.id, fieldSlug: field.slug, operator: "equals", value: "todo" },
    { fieldSlug: "status", operator: "not_empty" },
  ],
  sorts: [
    { direction: "desc", fieldSlug: "owner" },
    { direction: "asc", fieldId: field.id, fieldSlug: field.slug },
  ],
  visibleFieldSlugs: ["owner", "title", "status"],
  cardSize: "large",
};

describe("view config quick updates", () => {
  it("makes a field sort primary while preserving unrelated config and sorts", () => {
    const next = setPrimaryViewSort(config, field, "desc");
    expect(next.sorts).toEqual([
      { direction: "desc", fieldId: field.id, fieldSlug: field.slug },
      { direction: "desc", fieldSlug: "owner" },
    ]);
    expect(next.cardSize).toBe("large");
    expect(clearViewSort(next, field).sorts).toEqual([{ direction: "desc", fieldSlug: "owner" }]);
  });

  it("replaces and clears only the first filter for a field", () => {
    const replacement = {
      fieldId: field.id,
      fieldSlug: field.slug,
      operator: "contains" as const,
      value: "review",
    };
    const replaced = replaceFirstViewFilter(config, field, replacement);
    expect(replaced.filters).toEqual([config.filters[0], replacement, config.filters[2]]);
    expect(clearFirstViewFilter(replaced, field).filters).toEqual([
      config.filters[0],
      config.filters[2],
    ]);
  });

  it("derives defaults in schema order and hides one field", () => {
    expect(getVisibleViewFieldSlugs({ ...config, visibleFieldSlugs: undefined }, fields)).toEqual([
      "title",
      "status",
      "owner",
    ]);
    expect(hideViewField(config, field, fields).visibleFieldSlugs).toEqual(["owner", "title"]);
  });

  it("preserves configured order and moves a field without changing global schema order", () => {
    expect(getVisibleViewFieldSlugs(config, fields)).toEqual(["owner", "title", "status"]);
    const next = moveViewField(config, fields, "owner", "status", "after");
    expect(next.visibleFieldSlugs).toEqual(["title", "status", "owner"]);
    expect(fields.map((item) => item.slug)).toEqual(["title", "status", "owner"]);
    expect(moveViewField(config, fields, "owner", "title", "before").visibleFieldSlugs).toEqual([
      "owner",
      "title",
      "status",
    ]);
    expect(moveViewField(config, fields, "status", "owner", "before").visibleFieldSlugs).toEqual([
      "status",
      "owner",
      "title",
    ]);
    expect(moveViewField(config, fields, "missing", "owner", "before")).toBe(config);
  });

  it("drops unknown and duplicate configured slugs without reordering known fields", () => {
    expect(
      getVisibleViewFieldSlugs(
        { ...config, visibleFieldSlugs: ["owner", "missing", "owner", "title"] },
        fields,
      ),
    ).toEqual(["owner", "title"]);
  });

  it("normalizes and stores per-view field widths", () => {
    expect(clampViewFieldWidth(12)).toBe(92);
    expect(clampViewFieldWidth(700.4)).toBe(640);
    expect(setViewFieldWidth(config, "title", 247.6).fieldWidths).toEqual({ title: 248 });
    const withWidths = { ...config, fieldWidths: { owner: 180, title: 248 } };
    expect(resetViewFieldWidth(withWidths, "title").fieldWidths).toEqual({ owner: 180 });
    expect(
      resetViewFieldWidth({ ...config, fieldWidths: { title: 248 } }, "title").fieldWidths,
    ).toBe(undefined);
    expect(resetViewFieldWidth(config, "title")).toBe(config);
  });

  it("prefers a stable field id over a reused slug", () => {
    expect(matchesViewField({ fieldId: "fld_old", fieldSlug: "status" }, field)).toBe(false);
    expect(matchesViewField({ fieldSlug: "status" }, field)).toBe(true);
  });
});
