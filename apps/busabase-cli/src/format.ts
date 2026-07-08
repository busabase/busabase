export type OutputFormat = "text" | "table" | "json";

/** Render a command result as JSON, a compact text view, or an aligned table. */
export function render(value: unknown, output: OutputFormat): string {
  if (output === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (output === "text") {
    return renderText(value);
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
  if (typeof value === "object") return compactJson(value);
  return truncate(String(value));
}

function compactJson(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((item) => typeof item !== "object" || item === null)) {
      return truncate(value.map((item) => String(item)).join(", "));
    }
    return `[${value.length} items]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""}}`;
  }
  return truncate(String(value));
}

function truncate(value: string, max = 72): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max - 1)}…`;
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

function renderText(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "(no rows)";
    if (isNodeTree(value)) return renderNodeTree(value);
    if (typeof value[0] !== "object" || value[0] === null) {
      return value.map((item) => cell(item)).join("\n");
    }
    return renderTable(value);
  }
  if (value && typeof value === "object") {
    return renderRecord(value as Record<string, unknown>);
  }
  return String(value);
}

interface NodeLike {
  id?: unknown;
  type?: unknown;
  slug?: unknown;
  name?: unknown;
  baseId?: unknown;
  children?: unknown;
}

function isNodeTree(value: unknown[]): value is NodeLike[] {
  return value.every(isNodeLike);
}

function isNodeLike(value: unknown): value is NodeLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as NodeLike;
  return (
    typeof row.id === "string" &&
    typeof row.type === "string" &&
    typeof row.slug === "string" &&
    typeof row.name === "string" &&
    Array.isArray(row.children)
  );
}

function renderNodeTree(nodes: NodeLike[]): string {
  const lines: string[] = [];
  const walk = (items: NodeLike[], prefix: string, isRoot: boolean) => {
    items.forEach((node, index) => {
      const isLast = index === items.length - 1;
      const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
      const childPrefix = isRoot ? "" : `${prefix}${isLast ? "   " : "│  "}`;
      lines.push(`${prefix}${branch}${formatNode(node)}`);
      const children = Array.isArray(node.children) ? node.children.filter(isNodeLike) : [];
      walk(children, childPrefix, false);
    });
  };
  walk(nodes, "", true);
  return lines.join("\n");
}

function formatNode(node: NodeLike): string {
  const type = String(node.type ?? "node");
  const name = String(node.name ?? node.slug ?? node.id ?? "Untitled");
  const slug = typeof node.slug === "string" && node.slug !== name ? ` /${node.slug}` : "";
  const base = typeof node.baseId === "string" && node.baseId ? ` base=${node.baseId}` : "";
  return `${nodeIcon(type)} ${name}${slug}  (${type}${base}, id=${node.id})`;
}

function nodeIcon(type: string): string {
  switch (type) {
    case "folder":
      return "[folder]";
    case "base":
      return "[base]";
    case "doc":
      return "[doc]";
    case "skill":
      return "[skill]";
    case "drive":
      return "[drive]";
    default:
      return "[node]";
  }
}
