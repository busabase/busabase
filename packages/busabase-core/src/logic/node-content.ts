import "server-only";

import { ORPCError } from "@orpc/server";
/**
 * The registry of node types whose content lives as ONE object in storage —
 * the single place that answers "which node types have searchable content,
 * where is it, and how do I turn it into scannable text".
 *
 * Before this existed, `logic/grep.ts` hardcoded `eq(busabaseNodes.type,
 * "doc")`, so `html`, `whiteboard` and `workflow` — whose content moved into
 * object storage precisely so it would sit "on the same grep pipeline as Docs"
 * (see `content/spec/node-content-storage.md`) — were silently unsearchable.
 * Adding a fifth such type should mean adding a row here and nothing else.
 *
 * Deliberately server-side (`logic/`, not the `busabase-contract` node-type
 * registry): storage keys and text extraction are backend concerns, and the
 * contract package is imported into the browser bundle and the mobile client's
 * generated types, where neither belongs.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import { busabaseNodes } from "../db/schema";
import type { MutableTextSource } from "../domains/assets/logic/text-cache";
import { openMutableTextSource } from "../domains/assets/logic/text-cache";
import {
  type DocLinesResult,
  docBodyKey,
  sliceDocLinesRange,
  splitDocLines as splitTextLines,
} from "../domains/doc/handlers";
import { richNodeDocumentKey } from "../domains/rich-node/handlers";
import {
  extractWhiteboardSearchableText,
  extractWorkflowSearchableText,
} from "../domains/rich-node/utils/searchable-text";
import { buildNodeVisibilityCondition } from "./node-acl";
import { ensureReady } from "./seed";

export interface NodeContentAdapter {
  /** The storage key holding this node's content. */
  storageKey(nodeId: string): string;
  /**
   * Turn the stored object into line-oriented searchable text.
   *
   * `undefined` means the stored object ALREADY IS that text and can be
   * scanned as-is — which is the better case in two ways: it can be streamed
   * line by line without ever holding the whole object in memory, and every
   * reported line number is a REAL source line the user can open the file at.
   * `doc` (markdown) and `html` (raw source, stored unwrapped on purpose) are
   * both in that camp.
   *
   * When present, the whole object must be read and converted first, so the
   * scan is not streamed and the resulting line numbers are SYNTHETIC — they
   * index the extracted text, not the stored JSON. See
   * `domains/rich-node/utils/searchable-text.ts` for why that tradeoff is
   * still worth it for `whiteboard`/`workflow`.
   */
  toSearchableText?(raw: string): string;
}

export const NODE_CONTENT_ADAPTERS = {
  doc: { storageKey: docBodyKey },
  html: { storageKey: (nodeId: string) => richNodeDocumentKey(nodeId, "html") },
  whiteboard: {
    storageKey: (nodeId: string) => richNodeDocumentKey(nodeId, "whiteboard"),
    toSearchableText: extractWhiteboardSearchableText,
  },
  workflow: {
    storageKey: (nodeId: string) => richNodeDocumentKey(nodeId, "workflow"),
    toSearchableText: extractWorkflowSearchableText,
  },
} as const satisfies Record<string, NodeContentAdapter>;

/** Node types that have searchable stored content — the grep candidate filter. */
export type SearchableNodeType = keyof typeof NODE_CONTENT_ADAPTERS;

export const SEARCHABLE_NODE_TYPES = Object.keys(NODE_CONTENT_ADAPTERS) as [
  SearchableNodeType,
  ...SearchableNodeType[],
];

export const isSearchableNodeType = (type: string): type is SearchableNodeType =>
  Object.hasOwn(NODE_CONTENT_ADAPTERS, type);

export const nodeContentAdapter = (type: SearchableNodeType): NodeContentAdapter =>
  NODE_CONTENT_ADAPTERS[type];

/**
 * Open a node's content object through the shared Drive grep text cache, for
 * any searchable node type — the generic counterpart to
 * `domains/doc/handlers.ts`'s Doc-specific `openDocBodySource`.
 *
 * The cache key MUST stay `${type}:${nodeId}`, which is exactly what
 * `openDocBodySource` already builds for Docs (`doc:${nodeId}`). That
 * agreement is load-bearing, not cosmetic: it is what lets a grep over Docs
 * and an agent's follow-up `readDocLines` on the hit share one warmed entry
 * instead of downloading the same object twice. (The two are separate
 * functions rather than one because `logic/` may import a domain, but a domain
 * importing back out of `logic/` would be a cycle.)
 */
export const openNodeContentSource = async (
  type: SearchableNodeType,
  nodeId: string,
): Promise<MutableTextSource> =>
  openMutableTextSource({
    cacheKey: `${type}:${nodeId}`,
    storageKey: NODE_CONTENT_ADAPTERS[type].storageKey(nodeId),
  });

/**
 * The node's content as scannable lines. Streams straight off the cached file
 * for the text-native types (`doc`/`html`) so a large body never lands in
 * memory whole; buffers-then-extracts only for the JSON types, which have no
 * way around reading the whole object before it means anything.
 */
export const openNodeContentLines = async (
  type: SearchableNodeType,
  nodeId: string,
): Promise<AsyncIterable<string>> => {
  const source = await openNodeContentSource(type, nodeId);
  const adapter = NODE_CONTENT_ADAPTERS[type] as NodeContentAdapter;
  if (!adapter.toSearchableText) return source.iterateLines();
  return linesFromText(adapter.toSearchableText(await source.readText()));
};

/**
 * Adapt a whole text blob to the async line iterable `scanLines` consumes.
 * Exported because `logic/grep.ts`'s records adapter needs the exact same
 * adapter for a flattened field value — it used to keep a byte-identical
 * private copy (`linesFromBody`), which is one line-splitting convention
 * maintained in two places for no reason.
 */
export async function* linesFromText(text: string): AsyncGenerator<string> {
  for (const line of splitTextLines(text)) {
    yield line;
  }
}

/**
 * Resolve a content-bearing node by id OR slug, honouring node ACL — the
 * generic counterpart to `domains/doc/handlers.ts`'s `getDocNode`, which
 * hardcodes `type: "doc"` on both of its lookup paths.
 *
 * A node that exists but whose type stores no content is reported as not
 * found rather than as a distinct error: to a caller asking "read me lines
 * from this node", a Base or a Folder simply has no lines, and saying so in
 * more detail would leak the existence of nodes the ACL may be hiding.
 */
const resolveContentNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const visible = buildNodeVisibilityCondition(db);
  const [node] = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        or(eq(busabaseNodes.id, nodeIdOrSlug), eq(busabaseNodes.slug, nodeIdOrSlug)),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  return node && isSearchableNodeType(node.type) ? { id: node.id, type: node.type } : null;
};

/**
 * Read an exact line range from ANY content-bearing node — the follow-up an
 * agent makes on a `grep` hit.
 *
 * Before this existed only `docs.readLines` did, resolving `type: "doc"`
 * only, so once grep started reporting `html`/`whiteboard`/`workflow` matches
 * it was pointing agents at lines they then could not read: the follow-up
 * failed with "Doc not found", and the only fallback (`nodes.get`) returns
 * the ENTIRE document, which is exactly what a line range exists to avoid.
 *
 * Line numbers mean whatever they mean for the node's type — real source
 * lines for `doc`/`html`, positions within the extracted text for the JSON
 * types. Because it reads through the same registry as grep, the two can
 * never disagree about what "line 3" is.
 */
export const readNodeLines = async (
  nodeIdOrSlug: string,
  startLine: number,
  endLine: number,
): Promise<DocLinesResult> => {
  await ensureReady();
  const node = await resolveContentNode(nodeIdOrSlug);
  if (!node) {
    throw new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeIdOrSlug}` });
  }
  // Read in full: `sliceDocLinesRange` reports `totalLines`, so stopping the
  // stream at `endLine` would make that number a lie. Bounded by the same
  // content-size caps every write path already enforces.
  const lines: string[] = [];
  for await (const line of await openNodeContentLines(node.type, node.id)) {
    lines.push(line);
  }
  return sliceDocLinesRange(lines, startLine, endLine);
};
