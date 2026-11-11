import type { FieldType } from "busabase-contract/types";
import { buildTableCellPreview, TABLE_CELL_PREVIEW_MAX_CHARS } from "./table-cell-preview";

export type GridCellPresentation = "text" | "scalar" | "collection" | "media" | "link" | "derived";

/** An exhaustive display policy: new field types must choose their grid behavior. */
export const GRID_FIELD_PRESENTATION = {
  text: "text",
  longtext: "text",
  markdown: "text",
  html: "text",
  code: "text",
  json: "text",
  yaml: "text",
  whiteboard: "media",
  attachment: "media",
  drive: "media",
  relation: "collection",
  member: "collection",
  lookup: "derived",
  number: "scalar",
  formula: "derived",
  date: "scalar",
  checkbox: "scalar",
  select: "collection",
  multiselect: "collection",
  url: "link",
  embed: "media",
  email: "link",
  phone: "link",
  created_time: "scalar",
  updated_time: "scalar",
  created_by: "collection",
  updated_by: "collection",
  auto_number: "scalar",
  ai_summary: "text",
  ai_tags: "collection",
} satisfies Record<FieldType, GridCellPresentation>;

export const gridTextLines = (rowHeight: number) => Math.max(1, Math.floor((rowHeight - 8) / 20));

/** Slice before normalizing; preserve authored newlines without formatting an unbounded value. */
export function buildGridCellText(value: unknown) {
  const preview = buildTableCellPreview(value);
  return typeof value === "string"
    ? {
        ...preview,
        text: value
          .slice(0, TABLE_CELL_PREVIEW_MAX_CHARS)
          .replace(/\r\n?/g, "\n")
          .replace(/\t/g, "  ")
          .trimEnd(),
      }
    : preview;
}

export function gridCollectionItemWidth(label: string, extra = 20) {
  return (
    Array.from(label).reduce(
      (width, character) => width + ((character.codePointAt(0) ?? 0) >= 0x2e80 ? 14 : 7.5),
      0,
    ) + extra
  );
}

/** Fit complete fixed-height items and reserve the overflow action before picking a prefix. */
export function gridCollectionLayout(
  width: number,
  rowHeight: number,
  itemWidths: readonly number[],
) {
  const gap = 4;
  const itemHeight = 24;
  const maxRows = Math.max(1, Math.floor((rowHeight - 8 + gap) / (itemHeight + gap)));
  const fits = (count: number) => {
    const widths = itemWidths.slice(0, count).map((value) => Math.min(width, value));
    if (count < itemWidths.length) {
      widths.push(Math.min(width, Math.max(36, String(itemWidths.length - count).length * 8 + 20)));
    }
    let rows = 1;
    let used = 0;
    for (const value of widths) {
      if (used > 0 && used + gap + value > width) {
        rows++;
        used = 0;
      }
      used += (used ? gap : 0) + value;
    }
    return rows <= maxRows;
  };
  let visible = fits(itemWidths.length) ? itemWidths.length : 0;
  if (visible === itemWidths.length) {
    return { visible, hidden: 0, maxRows, itemHeight, gap };
  }
  for (let count = 1; count <= itemWidths.length; count++) {
    if (fits(count)) visible = count;
    else break;
  }
  return { visible, hidden: itemWidths.length - visible, maxRows, itemHeight, gap };
}
