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
  const envelope = asEnvelope(value);
  if (envelope) return renderEnvelope(envelope, renderTable);
  if (value && typeof value === "object") {
    return renderRecord(value as Record<string, unknown>);
  }
  return String(value);
}

/**
 * A paginated response: exactly one array of rows plus scalar metadata beside it
 * (`{ records, nextCursor }`, `{ changeRequests, nextCursor }`).
 *
 * These used to reach {@link renderRecord}, which compacts a nested array to
 * `[10 items]` — so `records list --limit 10 --output text` printed two lines and
 * not one record, and `--output json` (151 KB for those same ten rows) was the
 * only mode that carried data at all.
 *
 * The "every other key is a scalar" test is what keeps a genuine multi-part
 * result out: `whoami` returns `{ space, user, member, spaces }`, whose object
 * values mean it is a record with an array in it, not rows with metadata.
 */
export interface Envelope {
  key: string;
  rows: unknown[];
  meta: [string, unknown][];
}

export function asEnvelope(value: unknown): Envelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  const arrays = entries.filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]));
  if (arrays.length !== 1) return undefined;
  const meta = entries.filter(([, item]) => !Array.isArray(item));
  const scalarOnly = meta.every(
    ([, item]) => item === null || item === undefined || typeof item !== "object",
  );
  if (!scalarOnly) return undefined;
  return { key: arrays[0][0], rows: arrays[0][1], meta };
}

function renderEnvelope(envelope: Envelope, renderRows: (rows: unknown[]) => string): string {
  const body = envelope.rows.length === 0 ? `(no ${envelope.key})` : renderRows(envelope.rows);
  const meta = envelope.meta.filter(([, item]) => item !== null && item !== undefined);
  if (meta.length === 0) return body;
  const width = Math.max(...meta.map(([key]) => key.length));
  const trailer = meta.map(([key, item]) => `${key.padEnd(width)}  ${cell(item)}`).join("\n");
  return `${body}\n\n${trailer}`;
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
  const envelope = asEnvelope(value);
  if (envelope) return renderEnvelope(envelope, renderText);
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

/**
 * Drop hydrated parents from a result, keeping the id that points at them.
 *
 * A record VO is ~4.5 KB, of which 3.6 KB is a full copy of its parent `base`
 * — repeated identically on every row, so ten records cost 151 KB and nine
 * copies of that Base are pure waste to any caller that already knows which
 * Base it asked about. `createdByUser` and `headCommit` are the same pattern.
 *
 * The test for "this is a hydration, not content" is deliberately structural
 * rather than a list of field names, so it does not rot as VOs change: an
 * object-valued key is dropped only when a sibling STRING key already
 * identifies the same thing — `base`/`baseId`, `headCommit`/`headCommitId`,
 * `createdByUser`/`createdBy`. Nothing that lacks such a sibling is touched,
 * which is why a Base's `fields`, a node's `children`, and `whoami`'s `space`
 * all survive: dropping those would remove the answer, not a duplicate.
 */
export function slim(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(slim);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  const scalarKeys = Object.entries(row)
    .filter(([, item]) => typeof item === "string")
    .map(([key]) => key);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(row)) {
    if (isHydrated(key, item, scalarKeys)) continue;
    out[key] = slim(item);
  }
  return out;
}

/**
 * `carriesPayload` is the guard that stops this from eating the answer. A
 * record's `headCommit` is structurally indistinguishable from its `base` — an
 * object whose `id` is already on the row as `headCommitId` — but it is where
 * the record's FIELD VALUES live (`headCommit.payload`), so dropping it would
 * return ten rows of ids and no data. Every commit-shaped object in this
 * contract carries `payload`; no hydrated parent does.
 */
const isHydrated = (key: string, item: unknown, scalarKeys: string[]): boolean => {
  if (item === null || typeof item !== "object") return false;
  if (carriesPayload(item)) return false;
  return scalarKeys.some(
    (scalar) => scalar !== key && (scalar === `${key}Id` || key.startsWith(scalar)),
  );
};

const carriesPayload = (item: object): boolean =>
  Array.isArray(item)
    ? item.some((entry) => entry !== null && typeof entry === "object" && carriesPayload(entry))
    : "payload" in item;
