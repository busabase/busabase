import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { LIST_OMITTED_FIELD_VALUE } from "../utils/list-payload-preview";
import { getEditorFieldValue, normalizeEditorFieldValue } from "./field";
import {
  canEditCellValueInline,
  getInlineCellEditorKind,
  isSameInlineCellValue,
  parseInlineCellDraft,
  parseNumberDraft,
  preserveInlineTextLineEndings,
  toInlineCellDraft,
} from "./inline-cell-edit";
import { TABLE_CELL_PREVIEW_MAX_CHARS } from "./table-cell-preview";

const field = (
  type: BaseFieldVO["type"],
  extra: Partial<BaseFieldVO> = {},
  options: BaseFieldVO["options"] = {},
): BaseFieldVO => ({
  id: `fld_${type}`,
  baseId: "bas",
  slug: type,
  name: type,
  type,
  required: false,
  position: 0,
  options,
  ...extra,
});

describe("which cells edit in place", () => {
  it("edits reverse relation columns through the same relation draft rules", () => {
    const reverse = field("relation", {}, { targetBaseId: "source", reverseOfFieldId: "forward" });
    expect(getInlineCellEditorKind(reverse)).toBe("relation");
    expect(canEditCellValueInline(reverse, ["existing"])).toBe(true);
    expect(parseInlineCellDraft(reverse, ["existing", "new"])).toEqual({
      ok: true,
      value: ["existing", "new"],
    });
    expect(parseInlineCellDraft(reverse, [])).toEqual({ ok: true, value: [] });
    expect(isSameInlineCellValue(reverse, ["existing"], ["existing"])).toBe(true);
    expect(canEditCellValueInline(reverse, LIST_OMITTED_FIELD_VALUE)).toBe(false);
  });

  it("covers compact editors and leaves full-record fields to the record", () => {
    expect(
      (
        [
          "text",
          "number",
          "select",
          "checkbox",
          "date",
          "url",
          "email",
          "phone",
          "member",
          "relation",
          "attachment",
        ] as const
      ).map((type) => getInlineCellEditorKind(field(type))),
    ).toEqual([
      "text",
      "number",
      "select",
      "checkbox",
      "date",
      "url",
      "email",
      "tel",
      "member",
      "relation",
      "attachment",
    ]);
    for (const type of [
      "longtext",
      "markdown",
      "json",
      "multiselect",
      "lookup",
      "formula",
      "ai_summary",
      "created_time",
      "embed",
    ] as const) {
      expect(getInlineCellEditorKind(field(type))).toBeNull();
    }
  });

  it("never edits a value the list left out, or text too long for one line", () => {
    expect(canEditCellValueInline(field("text"), LIST_OMITTED_FIELD_VALUE)).toBe(false);
    expect(canEditCellValueInline(field("text"), "x".repeat(TABLE_CELL_PREVIEW_MAX_CHARS))).toBe(
      true,
    );
    expect(
      canEditCellValueInline(field("text"), "x".repeat(TABLE_CELL_PREVIEW_MAX_CHARS + 1)),
    ).toBe(false);
    expect(canEditCellValueInline(field("text"), { not: "text" })).toBe(false);
    expect(canEditCellValueInline(field("number"), 129)).toBe(true);
    expect(canEditCellValueInline(field("member"), "usr_alice")).toBe(true);
    expect(canEditCellValueInline(field("member"), ["usr_alice", "usr_bob"])).toBe(true);
    expect(canEditCellValueInline(field("member"), ["usr_alice", 2])).toBe(false);
    expect(canEditCellValueInline(field("text"), undefined)).toBe(true);
  });
});

describe("preserving text line endings", () => {
  it.each(["a\nb", "a\r\nb", "a\rb", "a\r\nb\nc\rd"])(
    "keeps unchanged line endings while appending to %j",
    (previous) => {
      const normalized = previous.replace(/\r\n?/g, "\n");
      expect(preserveInlineTextLineEndings(previous, `${normalized}X`)).toBe(`${previous}X`);
      expect(preserveInlineTextLineEndings(previous, normalized)).toBe(previous);
    },
  );

  it("preserves both sides of an edit in the middle of mixed line endings", () => {
    expect(
      preserveInlineTextLineEndings("first\r\nmiddle\nlast\rend", "first\nupdated\nlast\nend"),
    ).toBe("first\r\nupdated\nlast\rend");
  });

  it("allows replacing or clearing text without bringing old line endings back", () => {
    expect(preserveInlineTextLineEndings("first\r\nlast", "replacement")).toBe("replacement");
    expect(preserveInlineTextLineEndings("first\r\nlast", "")).toBe("");
    expect(preserveInlineTextLineEndings("first\r\nlast", "firstlast")).toBe("firstlast");
  });
});

describe("number drafts", () => {
  it("reads prices the way people type them", () => {
    expect(parseNumberDraft("129")).toBe(129);
    expect(parseNumberDraft(" 129.50 ")).toBe(129.5);
    expect(parseNumberDraft("$1,299.50")).toBe(1299.5);
    expect(parseNumberDraft("USD 24")).toBe(24);
    expect(parseNumberDraft("24 USD")).toBe(24);
    expect(parseNumberDraft("-3")).toBe(-3);
    expect(parseNumberDraft("1 299")).toBe(1299);
    expect(parseNumberDraft(".5")).toBe(0.5);
  });

  it("refuses anything that is not exactly one number instead of guessing", () => {
    for (const text of ["abc", "12abc", "1,5", "1.2.3", "", "--1", "1,29"]) {
      expect(parseNumberDraft(text)).toBeNull();
    }
  });
});

describe("parsing a draft into the stored value", () => {
  it("stores numbers as numbers and an empty number as cleared", () => {
    expect(parseInlineCellDraft(field("number"), "$129.00")).toEqual({ ok: true, value: 129 });
    expect(parseInlineCellDraft(field("number"), "  ")).toEqual({ ok: true, value: null });
    expect(parseInlineCellDraft(field("number"), "twelve")).toEqual({
      ok: false,
      error: "number",
    });
    // `Number()` would read these; a price cell refuses them instead of guessing.
    expect(parseInlineCellDraft(field("number"), "0x10")).toEqual({ ok: false, error: "number" });
    expect(parseInlineCellDraft(field("number"), "1,5")).toEqual({ ok: false, error: "number" });
  });

  it("holds every type to the record form's field rules", () => {
    expect(parseInlineCellDraft(field("email"), "not-an-email")).toEqual({
      ok: false,
      error: "email",
    });
    expect(parseInlineCellDraft(field("email"), " ada@example.com ")).toEqual({
      ok: true,
      value: "ada@example.com",
    });
    expect(parseInlineCellDraft(field("url"), "example.com")).toEqual({ ok: false, error: "url" });
    expect(parseInlineCellDraft(field("url"), "https://example.com")).toEqual({
      ok: true,
      value: "https://example.com",
    });
    expect(parseInlineCellDraft(field("phone"), "ab")).toEqual({ ok: false, error: "phone" });
    expect(parseInlineCellDraft(field("date"), "2026-13-40")).toEqual({
      ok: false,
      error: "date",
    });
    expect(parseInlineCellDraft(field("date"), "2026-11-06")).toEqual({
      ok: true,
      value: "2026-11-06",
    });
    expect(parseInlineCellDraft(field("checkbox"), true)).toEqual({ ok: true, value: true });
  });

  it("refuses to clear a required field", () => {
    expect(parseInlineCellDraft(field("text", { required: true }), "   ")).toEqual({
      ok: false,
      error: "required",
    });
    expect(parseInlineCellDraft(field("number", { required: true }), "")).toEqual({
      ok: false,
      error: "required",
    });
  });

  it("only accepts a configured choice", () => {
    const status = field("select", {}, { choices: [{ id: "chc_new", name: "New" }] });
    expect(parseInlineCellDraft(status, "chc_new")).toEqual({ ok: true, value: "chc_new" });
    expect(parseInlineCellDraft(status, "chc_gone")).toEqual({ ok: false, error: "choice" });
    expect(parseInlineCellDraft(status, "")).toEqual({ ok: true, value: "" });
  });

  it("takes a time-of-day value as the form's date control stores it", () => {
    // The grid opens the record form's `DateFieldInput`, which already writes the
    // zoned value; the cell only holds it to the field rules.
    const meeting = field("date", {}, { date: { includeTime: true, timezone: "Asia/Shanghai" } });
    expect(parseInlineCellDraft(meeting, "2026-11-06T09:30:00+08:00")).toEqual({
      ok: true,
      value: "2026-11-06T09:30:00+08:00",
    });
    expect(parseInlineCellDraft(meeting, "")).toEqual({ ok: true, value: "" });
    // Same instant written in another offset is no change.
    expect(
      isSameInlineCellValue(meeting, "2026-11-06T01:30:00Z", "2026-11-06T09:30:00+08:00"),
    ).toBe(true);
  });
});

describe("the grid sends what the record form sends", () => {
  const status = field("select", {}, { choices: [{ id: "chc_new", name: "New" }] });
  const cases: [BaseFieldVO, unknown][] = [
    [field("text"), "Walking Robot Buddy"],
    [field("number"), "129.5"],
    [field("number"), ""],
    [field("checkbox"), true],
    [field("checkbox"), false],
    [field("date"), "2026-11-06"],
    [field("email"), "ada@example.com"],
    [field("url"), "https://example.com"],
    [field("phone"), "+1 555 0100"],
    [status, "chc_new"],
    [status, ""],
  ];

  it("stores the value the form's normalize step would", () => {
    for (const [target, input] of cases) {
      expect(parseInlineCellDraft(target, input)).toEqual({
        ok: true,
        value: normalizeEditorFieldValue(target, input),
      });
    }
  });

  it("opens a text editor on the text the form's input shows", () => {
    for (const [target, stored] of [
      [field("text"), "Robot"],
      [field("number"), 129.5],
      [field("email"), "ada@example.com"],
      [field("text"), null],
    ] as const) {
      expect(toInlineCellDraft(target, stored)).toBe(getEditorFieldValue(target, stored));
    }
  });
});

describe("unchanged values write nothing", () => {
  it("compares what is stored, not how it was typed", () => {
    expect(isSameInlineCellValue(field("number"), 129, 129)).toBe(true);
    expect(isSameInlineCellValue(field("number"), "129", 129)).toBe(true);
    expect(isSameInlineCellValue(field("number"), 0, null)).toBe(false);
    expect(isSameInlineCellValue(field("text"), undefined, "")).toBe(true);
    expect(isSameInlineCellValue(field("text"), "Robot", "Robot ")).toBe(false);
    expect(isSameInlineCellValue(field("checkbox"), "true", true)).toBe(true);
    const status = field("select", {}, { choices: [{ id: "chc_new", name: "New" }] });
    // A historical value stored as the choice NAME is the same choice.
    expect(isSameInlineCellValue(status, "New", "chc_new")).toBe(true);
  });
});
