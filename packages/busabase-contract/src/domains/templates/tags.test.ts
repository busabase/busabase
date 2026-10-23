import { describe, expect, it } from "vitest";
import { isInternalTemplateTag, visibleTemplateTags } from "./tags";

describe("visibleTemplateTags", () => {
  it("drops every prefix:value facet", () => {
    expect(
      visibleTemplateTags({
        category: "sales-crm",
        tags: ["sales-crm", "risk:gated-write", "surface:busabase", "industry:legal"],
      }),
    ).toEqual(["sales-crm"]);
  });

  it("leads with the category and keeps the plain tags in order, once each", () => {
    expect(
      visibleTemplateTags({ category: "crm", tags: ["sales", "accounts", "crm", "sales"] }),
    ).toEqual(["crm", "sales", "accounts"]);
  });

  it("returns nothing when only internal facets remain", () => {
    expect(visibleTemplateTags({ category: "", tags: ["risk:read-only"] })).toEqual([]);
    expect(visibleTemplateTags({ tags: [] })).toEqual([]);
  });

  it("ignores blank entries", () => {
    expect(visibleTemplateTags({ category: "  ", tags: ["", " ops "] })).toEqual(["ops"]);
  });
});

describe("isInternalTemplateTag", () => {
  it("is true exactly for prefixed facets", () => {
    expect(isInternalTemplateTag("risk:gated-write")).toBe(true);
    expect(isInternalTemplateTag("surface:busabase")).toBe(true);
    expect(isInternalTemplateTag("evidence-review")).toBe(false);
  });
});
