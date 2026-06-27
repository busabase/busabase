/** Render a command result as JSON or a compact text table. */
export function render(value: unknown, output: "table" | "json"): string {
  if (output === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (Array.isArray(value)) {
    return renderTable(value);
  }
  if (value && typeof value === "object") {
    return renderRecord(value as Record<string, unknown>);
  }
  return String(value);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderRecord(row: Record<string, unknown>): string {
  const keys = Object.keys(row);
  const width = Math.max(0, ...keys.map((k) => k.length));
  return keys.map((k) => `${k.padEnd(width)}  ${cell(row[k])}`).join("\n");
}

function renderTable(rows: unknown[]): string {
  if (rows.length === 0) return "(no rows)";
  if (typeof rows[0] !== "object" || rows[0] === null) {
    return rows.map((r) => cell(r)).join("\n");
  }
  const records = rows as Record<string, unknown>[];
  const columns = [...new Set(records.flatMap((r) => Object.keys(r)))];
  const widths = columns.map((c) => Math.max(c.length, ...records.map((r) => cell(r[c]).length)));
  const line = (cells: string[]) =>
    cells
      .map((value, i) => value.padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  const header = line(columns);
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  const body = records.map((r) => line(columns.map((c) => cell(r[c]))));
  return [header, sep, ...body].join("\n");
}
