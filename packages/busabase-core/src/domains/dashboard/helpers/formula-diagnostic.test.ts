import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  LIST_OMITTED_FIELD_VALUE,
  LIST_OMITTED_LONG_TEXT_VALUE,
} from "../utils/list-payload-preview";
import { formulaDependsOnOmittedValues } from "./formula-diagnostic";

const field = (slug: string, type: BaseFieldVO["type"], expression?: string) =>
  ({ slug, type, options: expression ? { formula: { expression } } : {} }) as BaseFieldVO;
const body = field("body", "longtext");
const total = field("total", "formula", "LEN({body})");
const record = (fields: BaseFieldVO[], payload: Record<string, unknown>) =>
  ({ base: { fields }, headCommit: { payload } }) as RecordVO;

describe("formula diagnostic input completeness", () => {
  it.each([LIST_OMITTED_FIELD_VALUE, LIST_OMITTED_LONG_TEXT_VALUE])(
    "recognizes a directly omitted input: %s",
    (marker) => {
      expect(formulaDependsOnOmittedValues(total, record([body, total], { body: marker }))).toBe(
        true,
      );
    },
  );

  it("walks chained formulas instead of trusting their stored result", () => {
    const chained = field("chained", "formula", "{total} + 1");
    expect(
      formulaDependsOnOmittedValues(
        chained,
        record([body, total, chained], { body: LIST_OMITTED_LONG_TEXT_VALUE, total: 10 }),
      ),
    ).toBe(true);
  });

  it.each(["relation", "lookup"] as const)("recognizes omitted %s inputs", (type) => {
    const source = field("source", type);
    const formula = field("total", "formula", "COUNTA({source})");
    expect(
      formulaDependsOnOmittedValues(
        formula,
        record([source, formula], { source: LIST_OMITTED_FIELD_VALUE }),
      ),
    ).toBe(true);
  });

  it("ignores unrelated omissions and field-like text inside string literals", () => {
    const formula = field("total", "formula", 'LEN("{body}")');
    expect(
      formulaDependsOnOmittedValues(
        formula,
        record([body, formula], { body: LIST_OMITTED_LONG_TEXT_VALUE }),
      ),
    ).toBe(false);
    expect(formulaDependsOnOmittedValues(total, record([body, total], { body: "complete" }))).toBe(
      false,
    );
  });

  it.each(["LEN(", "{missing} + LEN({body})", "NOPE({body})", "LEN({body}, 1)"])(
    "leaves invalid formulas to the existing diagnostic: %s",
    (expression) => {
      const formula = field("total", "formula", expression);
      expect(
        formulaDependsOnOmittedValues(
          formula,
          record([body, formula], { body: LIST_OMITTED_LONG_TEXT_VALUE }),
        ),
      ).toBe(false);
    },
  );

  it("does not hide an invalid chained formula behind an omitted sibling", () => {
    const broken = field("broken", "formula", "NOPE()");
    const formula = field("total", "formula", "LEN({body}) + {broken}");
    expect(
      formulaDependsOnOmittedValues(
        formula,
        record([body, broken, formula], { body: LIST_OMITTED_LONG_TEXT_VALUE }),
      ),
    ).toBe(false);
  });

  it("terminates cycles without treating them as missing inputs", () => {
    const a = field("a", "formula", "LEN({body}) + {b}");
    const b = field("b", "formula", "{a}");
    expect(
      formulaDependsOnOmittedValues(
        a,
        record([body, a, b], { body: LIST_OMITTED_LONG_TEXT_VALUE }),
      ),
    ).toBe(false);
  });
});
