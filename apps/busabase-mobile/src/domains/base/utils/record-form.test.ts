import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getPreview } from "~/domains/review/utils/busabase-display";
import {
  getChangedFieldValues,
  initialFieldValue,
  isCompactRecordFormField,
  isEditableField,
  normalizeFormValues,
} from "./record-form";

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

/**
 * `member` mirrors `relation`'s value shape (a list, or a scalar when
 * `options.multiple === false`) but — unlike relation — is editable on mobile.
 * Both halves of that shape have to survive the round trip through form state,
 * or the picker silently drops people.
 */
const memberField = (multiple?: boolean): BaseFieldVO =>
  ({
    ...field("member"),
    slug: "owner",
    options: multiple === undefined ? {} : { multiple },
  }) satisfies BaseFieldVO;

describe("member fields in the mobile record form", () => {
  it("is editable — assignment on the go is the point of the field type", () => {
    expect(isEditableField(memberField())).toBe(true);
    // Relation stays out: its picker would have to search a whole Base.
    expect(isEditableField(field("relation"))).toBe(false);
  });

  it("loads a multi-member value as its id array, not a joined string", () => {
    expect(initialFieldValue(memberField(), ["local-editor", "local-viewer"])).toEqual([
      "local-editor",
      "local-viewer",
    ]);
  });

  it("loads a single-member value as a scalar id", () => {
    expect(initialFieldValue(memberField(false), "local-editor")).toBe("local-editor");
    // An array arriving on a single-member field collapses to its first id.
    expect(initialFieldValue(memberField(false), ["local-viewer"])).toBe("local-viewer");
  });

  it("loads an unset member value as the control's empty value", () => {
    expect(initialFieldValue(memberField(), undefined)).toEqual([]);
    expect(initialFieldValue(memberField(false), undefined)).toBe("");
  });

  it("submits a multi-member field as an array", () => {
    expect(
      normalizeFormValues([memberField()], { owner: ["local-editor", "local-producer"] }),
    ).toEqual({ owner: ["local-editor", "local-producer"] });
  });

  it("submits an unset single-member field as null, never an empty string", () => {
    // "" would fail the server's member validator, which only accepts ids.
    expect(normalizeFormValues([memberField(false)], { owner: "" })).toEqual({ owner: null });
    expect(normalizeFormValues([memberField(false)], { owner: "local-editor" })).toEqual({
      owner: "local-editor",
    });
  });
});

describe("getPreview skips people-typed cells", () => {
  const definitions = [memberField(), { ...field("text"), slug: "notes" }];

  it("does not summarise a row with a list of user ids", () => {
    // Without the skip, "local-producer, local-viewer" (28 chars) wins the
    // "first text over 18 chars" race and becomes the row's subtitle.
    expect(
      getPreview(
        { owner: ["local-producer", "local-viewer"], notes: "A note long enough to win." },
        { definitions },
      ),
    ).toBe("A note long enough to win.");
  });

  it("also skips relation ids, which leak the same way", () => {
    // Seen on production before this change: a Deals row summarised as
    // "recseedcrmcompanynorthwind".
    const relationField = { ...field("relation"), slug: "company" };
    expect(
      getPreview(
        { company: ["rec_seed_crm_company_northwind"], notes: "A note long enough to win." },
        { definitions: [relationField, { ...field("text"), slug: "notes" }] },
      ),
    ).toBe("A note long enough to win.");
  });

  it("keeps the old behaviour when no definitions are passed", () => {
    expect(getPreview({ owner: ["local-producer", "local-viewer"] })).toContain("local-producer");
  });
});

/**
 * A `date` field is a TextInput on mobile. Day values must open and save as the
 * day they name wherever the phone is (run under TZ=America/Los_Angeles and
 * TZ=Asia/Shanghai); date-time values are typed as wall-clock time in the
 * field's zone and saved with that zone's offset.
 */
const dateField = (date?: { includeTime?: boolean; timezone?: string }): BaseFieldVO =>
  ({
    ...field("date"),
    slug: "due",
    options: date ? ({ date } as BaseFieldVO["options"]) : {},
  }) satisfies BaseFieldVO;

describe("date fields in the mobile record form", () => {
  it("opens a day value as the day it names, in every time zone", () => {
    expect(initialFieldValue(dateField(), "2026-10-02")).toBe("2026-10-02");
    expect(initialFieldValue(dateField(), "2026-10-02T00:00:00.000Z")).toBe("2026-10-02");
  });

  it("saves typed day text as YYYY-MM-DD", () => {
    expect(normalizeFormValues([dateField()], { due: "2026-10-02" })).toEqual({
      due: "2026-10-02",
    });
    expect(normalizeFormValues([dateField()], { due: " 2026-10-02 " })).toEqual({
      due: "2026-10-02",
    });
  });

  it("keeps an empty date as the form's empty value", () => {
    expect(initialFieldValue(dateField(), undefined)).toBe("");
    expect(normalizeFormValues([dateField()], { due: "" })).toEqual({ due: "" });
  });

  it("passes unreadable text through so the server's validator reports it", () => {
    expect(normalizeFormValues([dateField()], { due: "next friday" })).toEqual({
      due: "next friday",
    });
    expect(initialFieldValue(dateField(), "not a date")).toBe("not a date");
  });

  it("opens a date-time value as wall-clock time in the field's zone", () => {
    const shanghai = dateField({ includeTime: true, timezone: "Asia/Shanghai" });
    expect(initialFieldValue(shanghai, "2026-10-02T10:00:00Z")).toBe("2026-10-02 18:00");
  });

  it("saves typed date-time text with the field zone's offset", () => {
    const shanghai = dateField({ includeTime: true, timezone: "Asia/Shanghai" });
    expect(normalizeFormValues([shanghai], { due: "2026-10-02 18:00" })).toEqual({
      due: "2026-10-02T18:00:00+08:00",
    });
  });

  it("round-trips a date-time value without drifting", () => {
    const shanghai = dateField({ includeTime: true, timezone: "Asia/Shanghai" });
    const stored = "2026-10-02T18:00:00+08:00";
    const text = initialFieldValue(shanghai, stored);
    expect(normalizeFormValues([shanghai], { due: text })).toEqual({ due: stored });
  });

  it("sends an untouched date-time back exactly as stored, not re-stamped", () => {
    // No pinned zone: the device reads it in its own zone, whatever that is.
    const local = dateField({ includeTime: true });
    const stored = "2026-10-02T18:00:00+08:00";
    const text = initialFieldValue(local, stored);
    expect(normalizeFormValues([local], { due: text }, { due: stored })).toEqual({ due: stored });
  });

  it("an edited date-time is saved in the new wall-clock time", () => {
    const shanghai = dateField({ includeTime: true, timezone: "Asia/Shanghai" });
    expect(
      normalizeFormValues(
        [shanghai],
        { due: "2026-10-02 19:30" },
        { due: "2026-10-02T18:00:00+08:00" },
      ),
    ).toEqual({ due: "2026-10-02T19:30:00+08:00" });
  });
});
