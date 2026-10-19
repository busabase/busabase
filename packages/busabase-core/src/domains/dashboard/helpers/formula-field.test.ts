// @vitest-environment jsdom
import type { BaseFieldVO } from "busabase-contract/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formulaDependentFields,
  formulaFieldDraftKey,
  readFormulaFieldDraft,
  writeFormulaFieldDraft,
} from "./formula-field";

const field = (slug: string, expression: string): BaseFieldVO => ({
  id: slug,
  baseId: "base",
  slug,
  name: slug,
  type: "formula",
  required: false,
  position: 0,
  options: { formula: { expression } },
});
afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("formula editing safety", () => {
  it("finds transitive dependents and tolerates invalid legacy formulas", () => {
    const fields = [
      field("subtotal", "{price} * 2"),
      field("tax", "{subtotal} * 0.1"),
      field("total", "{subtotal} + {tax}"),
      field("bad", "("),
      field("other", "1"),
    ];
    expect(formulaDependentFields(fields, "price").map((item) => item.slug)).toEqual([
      "subtotal",
      "tax",
      "total",
    ]);
  });
  it("restores full configuration only inside the same viewer/base scope", () => {
    const key = formulaFieldDraftKey("space:user", "base");
    const draft = {
      operation: "add" as const,
      name: { "zh-CN": "合计", en: "Total" },
      slug: "total",
      formula: {
        expression: "{price} * 2",
        format: "currency" as const,
        precision: 2,
        currency: "CNY",
      },
    };
    writeFormulaFieldDraft(key, draft);
    expect(readFormulaFieldDraft(key)).toEqual(draft);
    expect(readFormulaFieldDraft(formulaFieldDraftKey("space:other-user", "base"))).toBeNull();
    expect(readFormulaFieldDraft(formulaFieldDraftKey("space:user", "other-base"))).toBeNull();
    writeFormulaFieldDraft(key, null);
    expect(readFormulaFieldDraft(key)).toBeNull();
  });
  it("ignores corrupt drafts and tolerates unavailable browser storage", () => {
    sessionStorage.setItem("bad", "{");
    expect(readFormulaFieldDraft("bad")).toBeNull();
    sessionStorage.setItem(
      "bad",
      JSON.stringify({
        operation: "add",
        name: "Total",
        slug: "total",
        formula: { expression: "1", precision: 100 },
      }),
    );
    expect(readFormulaFieldDraft("bad")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    expect(() =>
      writeFormulaFieldDraft("key", {
        operation: "add",
        name: "Total",
        slug: "total",
        formula: { expression: "1" },
      }),
    ).not.toThrow();
  });
});
