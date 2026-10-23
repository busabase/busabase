import type { ChangeRequestVO, OperationVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { coreMessagesEn } from "../../../i18n/messages";
import { describeViewConfig, getOperationFieldChanges } from "./operation-diff";

const changeRequest = {
  base: {
    fields: [
      { id: "fld_title", slug: "title", name: "Title" },
      { id: "fld_status", slug: "status", name: "Status" },
    ],
  },
} as unknown as ChangeRequestVO;

describe("view configuration diff", () => {
  it("describes field order separately from field membership and includes widths", () => {
    const rules = describeViewConfig(
      changeRequest,
      {
        filters: [],
        sorts: [],
        visibleFieldSlugs: ["status", "title"],
        fieldWidths: { title: 280 },
      },
      coreMessagesEn,
    );

    expect(rules.filter((rule) => rule.kind === "field").map((rule) => rule.key)).toEqual([
      "field:status",
      "field:title",
    ]);
    expect(rules.find((rule) => rule.kind === "order")?.label).toBe("Status → Title");
    expect(rules.find((rule) => rule.kind === "width")?.label).toBe("Title · 280px");
  });
});

it("hides formula merge guards on field proposals while retaining same-named record fields", () => {
  const operation = {
    operation: "base_add_field",
    baseFields: null,
    headCommit: {
      payload: {
        name: "Total",
        formulaDependencies: { price: "fld_price" },
        formulaBaseExpression: "{price}",
      },
    },
  } as unknown as OperationVO;
  expect(getOperationFieldChanges(changeRequest, operation).map((change) => change.slug)).toEqual([
    "name",
  ]);
  operation.operation = "record_create";
  expect(getOperationFieldChanges(changeRequest, operation).map((change) => change.slug)).toEqual([
    "name",
    "formulaDependencies",
    "formulaBaseExpression",
  ]);
});

it("labels a view's tab position and shows it counted from 1", () => {
  const operation = {
    operation: "view_update",
    baseFields: { name: "Board", description: "", config: { filters: [], sorts: [] }, position: 2 },
    headCommit: { payload: { position: 0 } },
  } as unknown as OperationVO;
  expect(getOperationFieldChanges(changeRequest, operation, coreMessagesEn)).toEqual([
    {
      slug: "position",
      label: "Position",
      beforeValue: 3,
      afterValue: 1,
      status: "changed",
    },
  ]);
});

it("describes grouped filter precedence and conjunction-only changes", () => {
  const filters = [
    { fieldSlug: "title", operator: "not_empty" },
    {
      conjunction: "or",
      conditions: [
        { fieldSlug: "status", operator: "equals", value: "pending" },
        { fieldSlug: "status", operator: "equals", value: "active" },
      ],
    },
  ];
  const andRule = describeViewConfig(changeRequest, { filters, sorts: [] }, coreMessagesEn).find(
    (rule) => rule.kind === "filter",
  );
  const orRule = describeViewConfig(
    changeRequest,
    { filters, filterConjunction: "or", sorts: [] },
    coreMessagesEn,
  ).find((rule) => rule.kind === "filter");
  expect(andRule?.label).toMatch(/Title.* AND \(Status.* OR Status.*\)/);
  expect(andRule?.key).not.toEqual(orRule?.key);
});
