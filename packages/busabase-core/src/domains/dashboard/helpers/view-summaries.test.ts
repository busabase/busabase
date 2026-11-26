import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildSummaryAggregates,
  computeSummaryValue,
  formatSummaryValue,
  getFieldSummaryFunctions,
  resolveViewFieldSummaries,
  setViewFieldSummary,
} from "./view-summaries";

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

const amount = field({ slug: "amount", type: "number" });
const price = field({
  slug: "price",
  type: "number",
  options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
});
const title = field({ slug: "title", type: "text" });
const stage = field({ slug: "stage", type: "select" });
const done = field({ slug: "done", type: "checkbox" });
const createdAt = field({ slug: "created_at", type: "created_time" });
const serial = field({ slug: "serial", type: "auto_number" });
const fields = [title, amount, price, stage, done, createdAt, serial];

describe("summary functions per field type", () => {
  it("offers numeric functions only on number-shaped fields", () => {
    expect(getFieldSummaryFunctions(amount)).toEqual([
      "sum",
      "avg",
      "min",
      "max",
      "filled",
      "empty",
      "percent_filled",
    ]);
    expect(getFieldSummaryFunctions(title)).toEqual(["filled", "empty", "percent_filled"]);
    expect(getFieldSummaryFunctions(stage)).toEqual(["filled", "empty", "percent_filled"]);
    expect(getFieldSummaryFunctions(done)).toEqual(["checked", "unchecked", "percent_checked"]);
    expect(getFieldSummaryFunctions(serial)).toEqual(["sum", "avg", "min", "max"]);
    expect(getFieldSummaryFunctions(createdAt)).toEqual([]);
  });

  it("skips stale entries: deleted fields and functions the type no longer supports", () => {
    const resolved = resolveViewFieldSummaries(
      {
        fieldSummaries: { amount: "sum", title: "avg", gone: "filled", stage: "percent_filled" },
      },
      fields,
    );
    expect([...resolved.entries()].map(([slug, summary]) => [slug, summary.fn])).toEqual([
      ["amount", "sum"],
      ["stage", "percent_filled"],
    ]);
  });
});

describe("summary aggregates", () => {
  it("reads count for the filled family on numbers and filled elsewhere, deduplicated", () => {
    const resolved = resolveViewFieldSummaries(
      {
        fieldSummaries: { amount: "empty", title: "percent_filled", stage: "filled", price: "avg" },
      },
      fields,
    );
    expect(buildSummaryAggregates(resolved.values())).toEqual([
      { fn: "avg", fieldSlug: "price" },
      { fn: "count", fieldSlug: "amount" },
      { fn: "filled", fieldSlug: "stage" },
      { fn: "filled", fieldSlug: "title" },
    ]);
    expect(
      buildSummaryAggregates([
        { field: amount, fn: "filled" },
        { field: amount, fn: "empty" },
        { field: amount, fn: "percent_filled" },
      ]),
    ).toEqual([{ fn: "count", fieldSlug: "amount" }]);
  });

  it("derives empty and percent filled from the bucket count", () => {
    const bucket = { count: 8, aggregates: { "filled:title": 6, "sum:amount": null } };
    expect(computeSummaryValue({ field: title, fn: "filled" }, bucket)).toEqual({
      kind: "count",
      value: 6,
    });
    expect(computeSummaryValue({ field: title, fn: "empty" }, bucket)).toEqual({
      kind: "count",
      value: 2,
    });
    expect(computeSummaryValue({ field: title, fn: "percent_filled" }, bucket)).toEqual({
      kind: "percent",
      value: 0.75,
    });
    // SUM over no values is NULL, never a confident zero.
    expect(computeSummaryValue({ field: amount, fn: "sum" }, bucket)).toEqual({ kind: "none" });
    // No bucket at all = no matching records.
    expect(computeSummaryValue({ field: title, fn: "empty" }, undefined)).toEqual({
      kind: "count",
      value: 0,
    });
    expect(computeSummaryValue({ field: title, fn: "percent_filled" }, undefined)).toEqual({
      kind: "none",
    });
  });
});

describe("checkbox summaries", () => {
  it("read the checked aggregate and derive unchecked and percent checked from the count", () => {
    const summaries = resolveViewFieldSummaries(
      { fieldSummaries: { done: "percent_checked", created_at: "filled" } },
      fields,
    );
    // A filled summary on an always-set field is stale and ignored.
    expect([...summaries.keys()]).toEqual(["done"]);
    expect(buildSummaryAggregates(summaries.values())).toEqual([
      { fn: "checked", fieldSlug: "done" },
    ]);
    const bucket = { count: 5, aggregates: { "checked:done": 2 } };
    expect(computeSummaryValue({ field: done, fn: "checked" }, bucket)).toEqual({
      kind: "count",
      value: 2,
    });
    expect(computeSummaryValue({ field: done, fn: "unchecked" }, bucket)).toEqual({
      kind: "count",
      value: 3,
    });
    expect(computeSummaryValue({ field: done, fn: "percent_checked" }, bucket)).toEqual({
      kind: "percent",
      value: 0.4,
    });
    expect(
      formatSummaryValue(
        { field: done, fn: "percent_checked" },
        { kind: "percent", value: 0.4 },
        "en",
      ),
    ).toBe("40%");
    expect(setViewFieldSummary(undefined, fields, "done", "filled")).toEqual({});
    expect(setViewFieldSummary(undefined, fields, "done", "unchecked")).toEqual({
      done: "unchecked",
    });
  });
});

describe("formatSummaryValue", () => {
  it("uses the field's own number formatting and lets avg keep extra precision", () => {
    expect(
      formatSummaryValue({ field: price, fn: "sum" }, { kind: "number", value: 1234.5 }, "en"),
    ).toBe("$1,234.50");
    expect(
      formatSummaryValue({ field: price, fn: "avg" }, { kind: "number", value: 10.12345 }, "en"),
    ).toBe("$10.1235");
    expect(
      formatSummaryValue({ field: amount, fn: "sum" }, { kind: "number", value: 0.1 + 0.2 }, "en"),
    ).toBe("0.3");
    expect(
      formatSummaryValue({ field: amount, fn: "avg" }, { kind: "number", value: 5 / 3 }, "en"),
    ).toBe("1.67");
  });

  it("formats counts, whole-number percentages and missing values", () => {
    expect(
      formatSummaryValue({ field: title, fn: "filled" }, { kind: "count", value: 1200 }, "en"),
    ).toBe("1,200");
    expect(
      formatSummaryValue(
        { field: title, fn: "percent_filled" },
        { kind: "percent", value: 2 / 3 },
        "en",
      ),
    ).toBe("67%");
    expect(formatSummaryValue({ field: amount, fn: "max" }, { kind: "none" }, "en")).toBe("—");
  });
});

describe("setViewFieldSummary", () => {
  it("sets, replaces and removes one column, pruning stale entries on the way", () => {
    const config = { fieldSummaries: { amount: "sum" as const, gone: "avg" as const } };
    expect(setViewFieldSummary(config, fields, "title", "filled")).toEqual({
      amount: "sum",
      title: "filled",
    });
    expect(setViewFieldSummary(config, fields, "amount", "max")).toEqual({ amount: "max" });
    expect(setViewFieldSummary(config, fields, "amount", null)).toEqual({});
    // An invalid function for the type is never written.
    expect(setViewFieldSummary(config, fields, "title", "sum")).toEqual({ amount: "sum" });
  });
});
