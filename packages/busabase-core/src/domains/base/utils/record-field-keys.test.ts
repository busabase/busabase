import { describe, expect, it } from "vitest";
import { describeRecordFieldKeyProblem, resolveRecordFieldKeys } from "./record-field-keys";

const fields = [
  { id: "fld_name", slug: "name", name: "Name" },
  { id: "fld_status", slug: "status", name: { en: "Status", "zh-CN": "状态" } },
  { id: "fld_owner", slug: "owner", name: "Owner" },
  { id: "fld_owner2", slug: "owner_2", name: "owner" },
];
const none = new Set<string>();

describe("resolveRecordFieldKeys", () => {
  it("leaves slug-keyed writes untouched", () => {
    expect(resolveRecordFieldKeys({ name: "a", status: "b" }, fields, none)).toEqual({
      ok: true,
      fields: { name: "a", status: "b" },
      renamed: [],
    });
  });

  it("maps field ids and display names (any locale, any case) to slugs", () => {
    const result = resolveRecordFieldKeys({ fld_name: "a", 状态: "b" }, fields, none);
    expect(result).toMatchObject({ ok: true, fields: { name: "a", status: "b" } });
    expect(resolveRecordFieldKeys({ " STATUS ": "x" }, fields, none)).toMatchObject({
      ok: true,
      fields: { status: "x" },
    });
  });

  it("refuses a display name shared by two fields", () => {
    expect(resolveRecordFieldKeys({ OWNER: "x" }, fields, none)).toMatchObject({
      ok: false,
      problem: { kind: "ambiguous-name", slugs: ["owner", "owner_2"] },
    });
  });

  it("an exact slug wins over another field's display name", () => {
    // "owner" is owner's slug AND owner_2's display name: it is the slug.
    expect(resolveRecordFieldKeys({ owner: "x" }, fields, none)).toMatchObject({
      ok: true,
      fields: { owner: "x" },
    });
  });

  it("refuses the same field given twice", () => {
    expect(resolveRecordFieldKeys({ name: "a", Name: "b" }, fields, none)).toMatchObject({
      ok: false,
      problem: { kind: "duplicate", slug: "name" },
    });
  });

  it("refuses a write in which no key names a live field", () => {
    expect(resolveRecordFieldKeys({ nmae: "a" }, fields, none)).toMatchObject({
      ok: false,
      problem: { kind: "none-matched", keys: ["nmae"] },
    });
    // Deleted-field keys alone are not a write either.
    expect(resolveRecordFieldKeys({ old: "a" }, fields, new Set(["old"]))).toMatchObject({
      ok: false,
    });
  });

  it("tolerates extra and deleted-field keys next to a live field (echoed payloads)", () => {
    const result = resolveRecordFieldKeys(
      { name: "a", old: "kept", extra: 1 },
      fields,
      new Set(["old"]),
    );
    expect(result).toMatchObject({ ok: true, fields: { name: "a", old: "kept", extra: 1 } });
  });

  it("a deleted field's slug is never re-read as a live field's display name", () => {
    const result = resolveRecordFieldKeys(
      { name: "a", Owner: "stale" },
      fields,
      new Set(["Owner"]),
    );
    expect(result).toMatchObject({ ok: true, fields: { name: "a", Owner: "stale" } });
  });

  it("an empty write is left alone", () => {
    expect(resolveRecordFieldKeys({}, fields, none)).toMatchObject({ ok: true, fields: {} });
  });
});

describe("describeRecordFieldKeyProblem", () => {
  it("lists the Base's fields as slug (name)", () => {
    const message = describeRecordFieldKeyProblem(
      { kind: "none-matched", keys: ["nmae"] },
      { slug: "leads", fields },
    );
    expect(message).toContain("nmae");
    expect(message).toContain("name (Name)");
    expect(message).toContain("status (Status)");
  });
});
