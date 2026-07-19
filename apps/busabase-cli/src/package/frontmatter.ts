/**
 * YAML frontmatter for doc nodes (§6.3): `name`, `description?`, `position?` above
 * the markdown body.
 *
 * Writing is deterministic (§6.6): a fixed key order and LF endings, so re-publishing
 * an unchanged doc is byte-identical.
 */
import { parse, stringify } from "yaml";

const DELIMITER = "---";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

/**
 * The canonical on-disk body: LF endings, no leading or trailing blank lines. Applied
 * on both read and write so the round trip is a fixed point — without it, the blank
 * line the writer puts after the closing `---` and the file's trailing newline would
 * accumulate into the body on every publish→install→publish cycle.
 *
 * Leading/trailing blank lines around a doc body are therefore normalized away on the
 * first publish; internal blank lines are untouched.
 */
export const normalizeDocBody = (body: string): string =>
  body.replaceAll("\r\n", "\n").replace(/^\n+/, "").replace(/\n+$/, "");

/** Split `---\n<yaml>\n---\n<body>`. A doc with no frontmatter is all body. */
export const parseFrontmatter = (text: string, filePath: string): ParsedFrontmatter => {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith(`${DELIMITER}\n`)) {
    return { data: {}, body: normalizeDocBody(normalized) };
  }
  const end = normalized.indexOf(`\n${DELIMITER}`, DELIMITER.length);
  if (end === -1) {
    throw new Error(
      `${filePath} opens YAML frontmatter with "---" but never closes it. Add a closing "---" line.`,
    );
  }
  const rawYaml = normalized.slice(DELIMITER.length + 1, end);
  const body = normalizeDocBody(normalized.slice(end + 1 + DELIMITER.length));

  let data: unknown;
  try {
    data = parse(rawYaml);
  } catch (error) {
    throw new Error(`${filePath} has invalid YAML frontmatter: ${(error as Error).message}`);
  }
  if (data === null || data === undefined) return { data: {}, body };
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${filePath} frontmatter must be a YAML mapping (key: value pairs).`);
  }
  return { data: data as Record<string, unknown>, body };
};

export interface DocFrontmatterFields {
  name: string;
  description: string;
  position: number | undefined;
}

/** Serialize a doc to `---\n<frontmatter>\n---\n<body>` with a trailing newline. */
export const serializeDoc = (fields: DocFrontmatterFields, body: string): string => {
  // Fixed key order — determinism. `description`/`position` are omitted when empty
  // so an unchanged doc round-trips to the same bytes it was published from.
  const data: Record<string, unknown> = { name: fields.name };
  if (fields.description) data.description = fields.description;
  if (fields.position !== undefined) data.position = fields.position;

  const yaml = stringify(data, { lineWidth: 0 }).replace(/\n$/, "");
  return `${DELIMITER}\n${yaml}\n${DELIMITER}\n\n${normalizeDocBody(body)}\n`;
};
