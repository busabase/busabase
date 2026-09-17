import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { parsePastedTable } from "./paste-table";

const field = (
  slug: string,
  type: BaseFieldVO["type"],
  extra: Partial<BaseFieldVO> = {},
): BaseFieldVO =>
  ({
    id: `fld-${slug}`,
    baseId: "bas-1",
    slug,
    name: slug.replace(/_/g, " "),
    type,
    required: false,
    position: 0,
    options: {},
    ...extra,
  }) as BaseFieldVO;

const FIELDS: BaseFieldVO[] = [
  field("title", "text"),
  field("due_date", "date"),
  field("score", "number"),
  field("done", "checkbox"),
  field("owner", "member"),
  field("created_at", "created_time"),
];

describe("parsePastedTable", () => {
  it("returns null when there is no data row under the header", () => {
    expect(parsePastedTable("title\tscore", FIELDS)).toBeNull();
    expect(parsePastedTable("", FIELDS)).toBeNull();
  });

  it("matches headers by slug and by display name, ignoring case and spacing", () => {
    const parsed = parsePastedTable("Title\tDue Date\tSCORE\nHello\t2026-01-02\t7", FIELDS);

    expect(parsed?.columns.map((column) => column.field?.slug)).toEqual([
      "title",
      "due_date",
      "score",
    ]);
    // The shared converter normalizes a date cell to a full ISO instant, which is
    // exactly what the grid stores — so an imported cell reads back identically.
    expect(parsed?.rows).toEqual([
      { title: "Hello", due_date: "2026-01-02T00:00:00.000Z", score: 7 },
    ]);
  });

  it("refuses columns the server would refuse, rather than importing them wrong", () => {
    const parsed = parsePastedTable("owner\tcreated_at\tnope\nu1\t2026-01-02\tx", FIELDS);

    expect(parsed?.columns.map((column) => column.unsupportedReason)).toEqual([
      "unconvertible",
      "system",
      "unmatched",
    ]);
    // Unsupported columns are absent from the payload entirely — not sent as null.
    expect(parsed?.rows).toEqual([{}]);
  });

  it("pads short rows so a trailing empty cell cannot shift values left", () => {
    const parsed = parsePastedTable("title\tscore\tdone\nOnly title", FIELDS);

    expect(parsed?.rawRows).toEqual([["Only title", "", ""]]);
    expect(parsed?.rows[0]?.title).toBe("Only title");
    // An empty cell is an explicit null, which the endpoint reads as "clear".
    expect(parsed?.rows[0]?.score).toBeNull();
  });

  it("only falls back to commas when the paste contains no tab at all", () => {
    const tabbed = parsePastedTable("title\tscore\na,b\t3", FIELDS);
    expect(tabbed?.commaSeparated).toBe(false);
    // The comma inside the cell stays inside the cell.
    expect(tabbed?.rows[0]?.title).toBe("a,b");

    const commas = parsePastedTable("title,score\nHello,3", FIELDS);
    expect(commas?.commaSeparated).toBe(true);
    expect(commas?.rows[0]).toEqual({ title: "Hello", score: 3 });
  });

  it("keeps a cell that cannot be converted out of the payload as null rather than throwing", () => {
    const parsed = parsePastedTable("title\tscore\nHello\tnot-a-number", FIELDS);

    expect(parsed?.rows[0]?.score).toBeNull();
  });

  it("skips blank lines instead of importing empty records", () => {
    const parsed = parsePastedTable("title\nA\n\n   \nB\n", FIELDS);

    expect(parsed?.rows).toHaveLength(2);
  });
});
