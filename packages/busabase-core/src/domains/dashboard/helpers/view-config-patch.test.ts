import type { ViewConfigVO, ViewVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getViewConfigPatch, getViewUpdatePayload } from "./view-config-patch";

const baseline: ViewConfigVO = {
  filters: [],
  sorts: [],
  visibleFieldSlugs: ["title", "status"],
  autoShowNewFields: false,
  fieldWidths: { title: 200, status: 180 },
};
const view = { name: "Grid", description: "", type: "table", config: baseline } as ViewVO;

describe("view edits against their opening snapshot", () => {
  it("sends only a width change, preserving unrelated live additions at merge", () => {
    expect(
      getViewConfigPatch(baseline, { ...baseline, fieldWidths: { title: 280, status: 180 } }),
    ).toEqual({ fieldWidths: { title: 280, status: 180 } });
  });

  it("omits unchanged metadata and settings from a rename", () => {
    expect(
      getViewUpdatePayload(view, {
        name: "Renamed",
        description: "",
        type: "table",
        config: baseline,
      }),
    ).toEqual({ name: "Renamed" });
  });

  it("retains null, empty arrays and empty maps as explicit clears", () => {
    expect(
      getViewConfigPatch(
        {
          ...baseline,
          dateFieldSlug: "date",
          filters: [{ fieldSlug: "title", operator: "not_empty" }],
        },
        { ...baseline, dateFieldSlug: null, fieldWidths: {}, filters: [] },
      ),
    ).toEqual({ dateFieldSlug: null, fieldWidths: {}, filters: [] });
  });

  it("ignores undefined and object insertion order while preserving list order", () => {
    expect(
      getViewConfigPatch(baseline, {
        ...baseline,
        fieldWidths: { status: 180, title: 200 },
        coverFieldSlug: undefined,
      }),
    ).toEqual({});
    expect(
      getViewConfigPatch(baseline, { ...baseline, fieldOrderSlugs: ["status", "title"] }),
    ).toEqual({ fieldOrderSlugs: ["status", "title"] });
  });

  it("keeps an explicit automatic policy with a changed allowlist", () => {
    const automatic = { ...baseline, autoShowNewFields: true };
    expect(getViewConfigPatch(automatic, { ...automatic, visibleFieldSlugs: ["title"] })).toEqual({
      visibleFieldSlugs: ["title"],
      autoShowNewFields: true,
    });
  });

  it("keeps a policy switch and its accompanying visibility snapshot together", () => {
    const original = {
      ...baseline,
      hiddenFieldSlugs: ["secret"],
      fieldOrderSlugs: ["title", "status"],
    };
    expect(getViewConfigPatch(original, { ...original, autoShowNewFields: true })).toEqual({
      autoShowNewFields: true,
      visibleFieldSlugs: ["title", "status"],
      hiddenFieldSlugs: ["secret"],
      fieldOrderSlugs: ["title", "status"],
    });
  });

  it("does not persist gallery display defaults during a rename", () => {
    expect(
      getViewUpdatePayload(
        { ...view, type: "gallery" },
        {
          name: "Gallery renamed",
          description: "",
          type: "gallery",
          config: {
            ...baseline,
            coverFieldSlug: "",
            coverFit: "cover",
            cardSize: "medium",
            showFieldLabels: false,
          },
        },
      ),
    ).toEqual({ name: "Gallery renamed" });
  });

  it("does not turn omitted Kanban cover settings into an edit during a rename", () => {
    expect(
      getViewUpdatePayload(
        { ...view, type: "kanban" },
        {
          name: "Board renamed",
          type: "kanban",
          config: {
            ...baseline,
            coverFieldSlug: null,
            coverFit: "cover",
            stackByFieldSlug: null,
            showFieldLabels: true,
          },
        },
      ),
    ).toEqual({ name: "Board renamed" });
  });

  it("distinguishes gallery automatic cover from explicit no-cover", () => {
    const gallery = {
      ...view,
      type: "gallery" as const,
      config: { ...baseline, coverFieldSlug: null },
    };
    expect(
      getViewUpdatePayload(gallery, {
        name: "Grid",
        type: "gallery",
        config: { ...baseline, coverFieldSlug: "" },
      }),
    ).toEqual({ config: { coverFieldSlug: "" } });
    expect(
      getViewUpdatePayload(gallery, {
        name: "Renamed",
        type: "gallery",
        config: { ...baseline, coverFieldSlug: null },
      }),
    ).toEqual({ name: "Renamed" });
  });
});
