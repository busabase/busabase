import { describe, expect, it } from "vitest";
import {
  LIST_OMITTED_FIELD_VALUE,
  LIST_OMITTED_LONG_TEXT_VALUE,
} from "../utils/list-payload-preview";
import { buildTableCellPreview, TABLE_CELL_PREVIEW_MAX_CHARS } from "./table-cell-preview";

describe("buildTableCellPreview", () => {
  it("bounds a multi-megabyte string before normalization", () => {
    const value = `${"first ".repeat(300_000)}tail-marker`;
    const preview = buildTableCellPreview(value);

    expect(preview.truncated).toBe(true);
    expect(preview.omitted).toBe(false);
    expect(preview.text.length).toBeLessThanOrEqual(TABLE_CELL_PREVIEW_MAX_CHARS);
    expect(preview.text).not.toContain("tail-marker");
  });

  it("projects large nested JSON without serializing the whole value", () => {
    const preview = buildTableCellPreview({
      title: "Report",
      rows: Array.from({ length: 5_000 }, (_, index) => ({
        id: index,
        body: "x".repeat(2_000),
      })),
    });

    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(TABLE_CELL_PREVIEW_MAX_CHARS);
    expect(preview.text).toContain("Report");
  });

  it("turns list omission markers into an explicit record-opening affordance", () => {
    expect(buildTableCellPreview(LIST_OMITTED_LONG_TEXT_VALUE).omitted).toBe(true);
    expect(buildTableCellPreview(LIST_OMITTED_FIELD_VALUE).omitted).toBe(true);
  });

  it("keeps ordinary short text unchanged", () => {
    expect(buildTableCellPreview("  Read   the task  ")).toEqual({
      text: "Read the task",
      truncated: false,
      omitted: false,
    });
  });

  it("serializes JSON that fits exactly, without trimming or a truncated flag", () => {
    for (const value of [
      { rows: [{ a: { b: 1 } }] },
      [1, 2, 3, 4],
      Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`k${index}`, index])),
      { nested: [[[[{ deep: true }]]]], empty: {}, none: null },
    ]) {
      expect(buildTableCellPreview(value)).toEqual({
        text: JSON.stringify(value),
        truncated: false,
        omitted: false,
      });
    }
  });

  it("flags JSON just past the limit and leaves JSON at the limit untouched", () => {
    const atLimit = ["x".repeat(TABLE_CELL_PREVIEW_MAX_CHARS - 4)];
    expect(JSON.stringify(atLimit)).toHaveLength(TABLE_CELL_PREVIEW_MAX_CHARS);
    expect(buildTableCellPreview(atLimit)).toMatchObject({
      text: JSON.stringify(atLimit),
      truncated: false,
    });
    expect(buildTableCellPreview(["x".repeat(TABLE_CELL_PREVIEW_MAX_CHARS - 3)]).truncated).toBe(
      true,
    );
  });

  it("does not throw on nested bigint, cycles or very deep values", () => {
    expect(buildTableCellPreview({ n: 1n }).text).toBe('{"n":1}');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(buildTableCellPreview(cycle).text).toBe('{"self":"[Circular]"}');
    let deep: unknown = 1;
    for (let depth = 0; depth < 50_000; depth += 1) deep = [deep];
    expect(buildTableCellPreview(deep).truncated).toBe(true);
  });
});
