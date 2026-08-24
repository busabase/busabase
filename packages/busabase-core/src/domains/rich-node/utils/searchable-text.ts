/**
 * Pure, isomorphic extraction of *searchable* text from the two rich-node
 * document types whose stored object is JSON rather than text.
 *
 * Why this exists: `doc` and `html` are stored as plain text (a Doc body is
 * markdown; an html node deliberately stores its raw `source` rather than a
 * JSON-wrapped document, precisely "so grep matches real HTML rather than
 * JSON-escaped HTML"), so grep can scan those objects byte-for-byte and every
 * reported line number is a real source line. `whiteboard` and `workflow`
 * store JSON. Scanning that JSON verbatim would match structural keys —
 * `"type"`, `"strokeColor"`, `"x"` — and drown the user's actual words in
 * noise, which is exactly the follow-up the node-content-storage spec called
 * out ("extracting text before scanning, so a whiteboard grep matches
 * Excalidraw `text` elements rather than JSON structural keys").
 *
 * LINE-NUMBER SEMANTICS (important, and deliberately different from doc/html):
 * the text returned here is SYNTHETIC — one line per extracted string, in
 * document order. A reported `line` therefore indexes this extracted text, NOT
 * any byte offset in the stored JSON, and is not a position a user can open the
 * file at. It exists to order and de-duplicate matches, not to navigate to.
 * `doc`/`html` keep real source line numbers; only these two are synthetic.
 *
 * Both functions are total: malformed/unparseable JSON yields "" (scans as
 * zero lines, i.e. "searched, no match") rather than throwing, and never falls
 * back to the type's EMPTY_* default document — fabricating a default's text
 * (e.g. the workflow default's "Manual trigger" label) would invent content the
 * user never wrote and report it as a hit.
 */

/** Read `key` off an unknown record iff it holds a non-empty string. */
const stringField = (value: Record<string, unknown>, key: string): string | null => {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Excalidraw elements are stored as `z.unknown()[]` — the schema passes them
 * through verbatim rather than restating Excalidraw's own element union, so
 * this reads them defensively.
 *
 * `originalText` is preferred over `text`: for a wrapped text element `text`
 * carries Excalidraw's inserted soft-wrap newlines while `originalText` is what
 * the user actually typed, so a phrase spanning a wrap point matches only the
 * latter. Frames contribute their `name`. Deleted elements are skipped —
 * Excalidraw tombstones rather than removes, and a user who deleted a sticky
 * note does not expect grep to keep finding it.
 */
export const extractWhiteboardSearchableText = (raw: string): string => {
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) return "";

  const lines: string[] = [];
  for (const element of parsed.elements) {
    if (!isRecord(element)) continue;
    if (element.isDeleted === true) continue;
    const text = stringField(element, "originalText") ?? stringField(element, "text");
    if (text) {
      lines.push(text);
      continue;
    }
    const name = stringField(element, "name"); // frames
    if (name) lines.push(name);
  }
  return lines.join("\n");
};

/**
 * Every user-authored string field on a workflow node/edge, by allowlist —
 * robust to the discriminated union gaining new kinds (a new kind's known
 * fields simply need adding here) without this module having to restate the
 * union itself.
 *
 * Schema-defaulted values (`eventName: "manual"`, edge `outcome: "default"`)
 * ARE included: they are the field's real stored value, and blocklisting
 * "looks like a default" would be fragile and would break finding a workflow by
 * its trigger event. The cost is that a grep for `manual` matches every
 * default-trigger workflow.
 */
const WORKFLOW_NODE_TEXT_FIELDS = [
  "label",
  "description",
  "eventName",
  "url",
  "functionName",
  "webhookRuleId",
  "expression",
  "approver",
  "actionName",
  "outcome",
] as const;

const WORKFLOW_EDGE_TEXT_FIELDS = ["label", "outcome"] as const;

const pushFields = (lines: string[], entries: unknown, fields: readonly string[]): void => {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    for (const field of fields) {
      const value = stringField(entry, field);
      if (value) lines.push(value);
    }
  }
};

export const extractWorkflowSearchableText = (raw: string): string => {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return "";
  const lines: string[] = [];
  pushFields(lines, parsed.nodes, WORKFLOW_NODE_TEXT_FIELDS);
  pushFields(lines, parsed.edges, WORKFLOW_EDGE_TEXT_FIELDS);
  return lines.join("\n");
};
