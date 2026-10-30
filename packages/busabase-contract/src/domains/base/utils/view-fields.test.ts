import { describe, expect, it } from "vitest";
import type { ViewConfigVO } from "../types";
import { getAutoShowNewFields, getVisibleViewFieldSlugs } from "./view-fields";

const fields = [
  { slug: "owner", position: 2 },
  { slug: "title", position: 0 },
  { slug: "status", position: 1 },
];
const config: ViewConfigVO = { filters: [], sorts: [] };

describe("shared view field selection", () => {
  it("honors automatic hidden fields and order while appending future schema fields", () => {
    const automatic = {
      ...config,
      autoShowNewFields: true,
      visibleFieldSlugs: ["title"],
      fieldOrderSlugs: ["owner", "title", "missing", "owner"],
      hiddenFieldSlugs: ["status", "title"],
    };
    expect(
      getVisibleViewFieldSlugs(automatic, [...fields, { slug: "attachment", position: 3 }]),
    ).toEqual(["title", "owner", "attachment"]);
  });

  it("preserves curated legacy fields and independent order across clients", () => {
    const legacy = { ...config, visibleFieldSlugs: ["owner", "status", "missing"] };
    expect(getAutoShowNewFields(legacy)).toBe(false);
    expect(getVisibleViewFieldSlugs(legacy, fields)).toEqual(["title", "owner", "status"]);
    expect(
      getVisibleViewFieldSlugs(
        { ...legacy, fieldOrderSlugs: ["status", "title", "owner"] },
        fields,
      ),
    ).toEqual(["title", "status", "owner"]);
  });

  it("keeps the title visible for an empty curated selection and handles an empty Base", () => {
    expect(getVisibleViewFieldSlugs({ ...config, visibleFieldSlugs: [] }, fields)).toEqual([
      "title",
    ]);
    expect(getVisibleViewFieldSlugs(config, [])).toEqual([]);
    expect(getAutoShowNewFields({ ...config, visibleFieldSlugs: null })).toBe(true);
  });
});
