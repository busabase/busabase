import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getChangedFieldValues, isCompactRecordFormField } from "./record-form";

const field = (type: BaseFieldVO["type"]): BaseFieldVO =>
  ({
    id: `field-${type}`,
    baseId: "base-1",
    slug: type,
    name: type,
    type,
    required: false,
    position: 0,
    options: {},
  }) satisfies BaseFieldVO;

describe("isCompactRecordFormField", () => {
  it("uses paired columns only for short editor controls", () => {
    expect(isCompactRecordFormField(field("number"))).toBe(true);
    expect(isCompactRecordFormField(field("date"))).toBe(true);
    expect(isCompactRecordFormField(field("checkbox"))).toBe(true);
    expect(isCompactRecordFormField(field("select"))).toBe(true);
    expect(isCompactRecordFormField(field("markdown"))).toBe(false);
    expect(isCompactRecordFormField(field("attachment"))).toBe(false);
    expect(isCompactRecordFormField(field("url"))).toBe(false);
  });
});

describe("getChangedFieldValues", () => {
  it("keeps only added and changed values", () => {
    expect(
      getChangedFieldValues(
        {
          title: "Before",
          metadata: { audience: "operators", priority: 1 },
          unchanged: true,
        },
        {
          title: "After",
          metadata: { priority: 1, audience: "operators" },
          unchanged: true,
          added: "New",
          ignored: undefined,
        },
      ),
    ).toEqual({ title: "After", added: "New" });
  });

  it("keeps every defined value when there is no base snapshot", () => {
    expect(
      getChangedFieldValues(null, { title: "Created", empty: null, ignored: undefined }),
    ).toEqual({ title: "Created", empty: null });
  });
});
