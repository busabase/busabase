import type { BaseFieldVO, ViewVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildViewGroupBy,
  getGroupableFields,
  gridGroupFilter,
  orderGridGroups,
  resolveViewGrouping,
} from "./view-grouping";

const field = (overrides: Partial<BaseFieldVO> & Pick<BaseFieldVO, "slug" | "type">) =>
  ({
    id: `fld_${overrides.slug}`,
    baseId: "base",
    name: overrides.slug,
    required: false,
    position: 0,
    options: {},
    ...overrides,
  }) as BaseFieldVO;

const stage = field({
  slug: "stage",
  type: "select",
  options: {
    choices: [
      { id: "c_lead", name: "Lead", color: "cyan" },
      { id: "c_won", name: "Won", color: "emerald" },
      { id: "c_lost", name: "Lost", color: "rose" },
    ],
  },
});
const done = field({ slug: "done", type: "checkbox" });
const title = field({ slug: "title", type: "text" });
const fields = [title, stage, done];

const view = (config: ViewVO["config"], type: ViewVO["type"] = "table") =>
  ({ type, config }) as Pick<ViewVO, "type" | "config">;

describe("resolveViewGrouping", () => {
  it("resolves a select or checkbox grouping on a table view", () => {
    expect(
      resolveViewGrouping(
        view({ filters: [], sorts: [], groupBy: [{ fieldSlug: "stage", direction: "desc" }] }),
        fields,
      ),
    ).toEqual({ field: stage, direction: "desc" });
    expect(
      resolveViewGrouping(
        view({ filters: [], sorts: [], groupBy: [{ fieldSlug: "done", direction: "asc" }] }),
        fields,
      )?.field,
    ).toBe(done);
  });

  it("falls back to the plain grid when the config no longer applies", () => {
    const grouped = {
      filters: [],
      sorts: [],
      groupBy: [{ fieldSlug: "stage", direction: "asc" as const }],
    };
    expect(resolveViewGrouping(view(grouped, "kanban"), fields)).toBeNull();
    expect(resolveViewGrouping(view({ filters: [], sorts: [] }), fields)).toBeNull();
    expect(resolveViewGrouping(view(grouped), [title, done])).toBeNull();
    // Type changed under the saved view.
    expect(resolveViewGrouping(view(grouped), [{ ...stage, type: "text" }])).toBeNull();
    // A stored id is authoritative: a new field reusing the slug is not picked up.
    expect(
      resolveViewGrouping(
        view({
          filters: [],
          sorts: [],
          groupBy: [{ fieldSlug: "stage", fieldId: "fld_deleted", direction: "asc" }],
        }),
        fields,
      ),
    ).toBeNull();
    expect(resolveViewGrouping(null, fields)).toBeNull();
  });

  it("lists only groupable fields and writes one level with the field id", () => {
    expect(getGroupableFields(fields)).toEqual([stage, done]);
    expect(buildViewGroupBy(stage, "desc")).toEqual([
      { fieldSlug: "stage", fieldId: "fld_stage", direction: "desc" },
    ]);
    expect(buildViewGroupBy(null, "asc")).toEqual([]);
  });
});

describe("orderGridGroups", () => {
  const response = [
    { value: "c_won", count: 2, aggregates: { "sum:amount": 10 } },
    { value: null, count: 1 },
    { value: "c_lead", count: 3 },
    { value: "c_lost", count: 0 },
    { value: "c_retired", count: 4 },
  ];

  it("orders a select by its choices, unknown ids next, the empty group last", () => {
    const groups = orderGridGroups({ field: stage, direction: "asc" }, response);
    expect(groups.map((group) => [group.key, group.kind, group.count])).toEqual([
      ["c_lead", "choice", 3],
      ["c_won", "choice", 2],
      ["c_retired", "unknown", 4],
      [null, "empty", 1],
    ]);
    expect(groups[1]?.aggregates).toEqual({ "sum:amount": 10 });
    expect(groups[1]?.choice?.name).toBe("Won");
  });

  it("reverses the choices for desc but keeps the empty group last", () => {
    const groups = orderGridGroups({ field: stage, direction: "desc" }, response);
    expect(groups.map((group) => group.key)).toEqual(["c_won", "c_lead", "c_retired", null]);
  });

  it("orders a checkbox unchecked first, checked first for desc", () => {
    const buckets = [
      { value: "true", count: 2 },
      { value: "false", count: 5 },
    ];
    expect(
      orderGridGroups({ field: done, direction: "asc" }, buckets).map((group) => group.kind),
    ).toEqual(["unchecked", "checked"]);
    expect(
      orderGridGroups({ field: done, direction: "desc" }, buckets).map((group) => group.kind),
    ).toEqual(["checked", "unchecked"]);
    expect(
      orderGridGroups({ field: done, direction: "asc" }, [{ value: "true", count: 1 }]),
    ).toHaveLength(1);
  });
});

describe("gridGroupFilter", () => {
  it("pages each bucket with the same operators a Kanban column uses", () => {
    expect(gridGroupFilter(stage, "c_won")).toEqual({
      fieldSlug: "stage",
      fieldType: "select",
      operator: "equals",
      value: "c_won",
    });
    expect(gridGroupFilter(stage, null)).toEqual({
      fieldSlug: "stage",
      fieldType: "select",
      operator: "is_empty",
    });
    expect(gridGroupFilter(done, "true").operator).toBe("is_true");
    expect(gridGroupFilter(done, "false").operator).toBe("is_false");
  });
});
