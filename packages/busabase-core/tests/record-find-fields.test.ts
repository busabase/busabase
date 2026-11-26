import type { BaseFieldVO, ViewConfigVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { resolveRecordFindFields } from "../src/domains/base/logic/record-find";

const field = (
  slug: string,
  type: BaseFieldVO["type"],
  position: number,
  options: BaseFieldVO["options"] = {},
): BaseFieldVO => ({
  id: `fld_${slug}`,
  baseId: "base",
  slug,
  name: slug,
  type,
  required: false,
  position,
  options,
});

const fields = [
  field("title", "text", 0),
  field("client", "text", 1),
  field("notes", "longtext", 2),
  field("status", "select", 3),
  field("config", "json", 4),
  field("due", "date", 5),
];
const slugs = (resolved: BaseFieldVO[]) => resolved.map((item) => item.slug);
const view = (config: Partial<ViewConfigVO>): ViewConfigVO => ({
  filters: [],
  sorts: [],
  ...config,
});

describe("record find field scope", () => {
  it("searches only the eligible fields the saved View shows by default", () => {
    const curated = view({ visibleFieldSlugs: ["title", "client", "status", "config"] });
    expect(slugs(resolveRecordFindFields(fields, { query: "acme" }, curated))).toEqual([
      "title",
      "client",
      "status",
    ]);
    const hiddenNotes = view({ autoShowNewFields: true, hiddenFieldSlugs: ["notes", "client"] });
    expect(slugs(resolveRecordFindFields(fields, { query: "acme" }, hiddenNotes))).toEqual([
      "title",
      "status",
    ]);
  });

  it("still searches a hidden field when the person chooses it", () => {
    const curated = view({ visibleFieldSlugs: ["title", "status"] });
    expect(
      slugs(resolveRecordFindFields(fields, { query: "acme", fieldId: "fld_notes" }, curated)),
    ).toEqual(["notes"]);
    expect(
      slugs(resolveRecordFindFields(fields, { query: "acme", fieldId: "fld_config" }, curated)),
    ).toEqual(["config"]);
  });

  it("searches every eligible field when the request has no View", () => {
    const all = ["title", "client", "notes", "status"];
    expect(slugs(resolveRecordFindFields(fields, { query: "acme" }))).toEqual(all);
    expect(slugs(resolveRecordFindFields(fields, { query: "acme" }, null))).toEqual(all);
  });

  it("keeps the primary field in scope, as the table always shows it", () => {
    const withoutPrimary = view({ visibleFieldSlugs: ["status"] });
    expect(slugs(resolveRecordFindFields(fields, { query: "acme" }, withoutPrimary))).toEqual([
      "title",
      "status",
    ]);
  });

  it("rejects a removed or unsupported chosen field instead of widening the scope", () => {
    const curated = view({ visibleFieldSlugs: ["title"] });
    expect(() =>
      resolveRecordFindFields(fields, { query: "acme", fieldId: "fld_gone" }, curated),
    ).toThrow(
      expect.objectContaining({ data: expect.objectContaining({ reason: "unknown_find_field" }) }),
    );
    expect(() =>
      resolveRecordFindFields(fields, { query: "acme", fieldId: "fld_due" }, curated),
    ).toThrow(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "unsupported_find_field" }),
      }),
    );
  });
});
