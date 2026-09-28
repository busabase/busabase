import "server-only";

/**
 * Playbook attribution — "which playbook produced this change request" (spec
 * `apps/busabase/content/spec/agent-playbook-discovery.md` §11b, H1).
 *
 * Write side: an agent declares the playbook it is following with ONE request
 * header, `x-busabase-playbook: <kind>:<nodeId>[:<key>]`. The transport calls
 * `withDeclaredPlaybook` once per request, inside the already-resolved
 * member/local context. The declaration is validated against what the caller
 * can read; a valid one is labelled server-side and put into the context's
 * source provenance, where `withContextSourceMeta` stamps it onto every change
 * request and audit row the request writes. An invalid, unreadable, or
 * malformed declaration is dropped silently — it never fails the write.
 *
 * Read side: `applyPlaybookAttributionVisibility` narrows the stored playbook
 * per reader in ONE batched query. A reader who cannot read the playbook node
 * sees only its kind (`accessible: false`), never its name or where it lives.
 */

import { customAgentPromptsSchema } from "busabase-contract/contract/node-agent-prompt-schemas";
import {
  BUSABASE_PLAYBOOK_HEADER,
  type PlaybookRef,
  parsePlaybookRef,
} from "busabase-contract/contract/playbook-schemas";
import type { PlaybookAttributionVO, SourceAttributionVO } from "busabase-contract/types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { iStringParse } from "openlib/i18n/i-string";
import {
  type BusabasePlaybookProvenance,
  type BusabaseSourceChannel,
  getContextSourceProvenance,
  getContextSpaceId,
  runWithContextPlaybook,
} from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes } from "../../../db/schema";
import { buildNodeVisibilityCondition } from "../../../logic/node-acl";
import { normalizeSourceChannel } from "../../../logic/source-attribution";

/**
 * Validate a declared playbook against the CURRENT context (space + reader
 * visibility) and label it from the node itself. Null when it does not hold up:
 * wrong space, archived/deleted, not readable, a "skill" that is not a skill
 * node, a prompt key the node does not define.
 */
export const resolveDeclaredPlaybook = async (
  ref: PlaybookRef,
): Promise<BusabasePlaybookProvenance | null> => {
  const db = await getDb();
  const [node] = await db
    .select({
      id: busabaseNodes.id,
      type: busabaseNodes.type,
      name: busabaseNodes.name,
      slug: busabaseNodes.slug,
      agentPrompts: busabaseNodes.agentPrompts,
    })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, ref.nodeId),
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .limit(1);
  if (!node) return null;

  const location = { nodeId: node.id, nodeType: node.type, nodeSlug: node.slug };
  if (ref.kind === "skill") {
    if (node.type !== "skill") return null;
    return { kind: "skill", key: null, label: node.name, ...location };
  }

  // Same validation the Ask Agent dialog and `playbooks.get` apply: a prompt
  // list that fails the schema has no prompts.
  const validated = customAgentPromptsSchema.safeParse(node.agentPrompts ?? null);
  const prompt = validated.success
    ? validated.data.find((entry) => entry.key === ref.key)
    : undefined;
  if (!prompt) return null;
  return {
    kind: "prompt",
    key: prompt.key,
    // Stored once, in English (falling back to whatever locale it has): the
    // label is a record of what was followed, not a UI string.
    label: iStringParse(prompt.label, "en"),
    ...location,
  };
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * How the open-source host names the channel alongside a playbook — it has no
 * other provenance. Mirrors Cloud's header sniff: explicit channel first, then
 * the client / user agent.
 */
const sniffChannel = (headers: Headers): BusabaseSourceChannel | null => {
  const explicit = normalizeSourceChannel(headers.get("x-busabase-channel"));
  if (explicit) return explicit;
  const client = (
    headers.get("x-busabase-client") ??
    headers.get("user-agent") ??
    ""
  ).toLowerCase();
  if (client.includes("busabase-cli")) return "cli";
  if (client.includes("mcp")) return "mcp";
  if (client.includes("sdk")) return "sdk";
  return null;
};

/**
 * Run `fn` with the request's declared playbook (if any, and valid) recorded
 * in the source provenance. Call once per request, INSIDE the resolved
 * member/local context. Reads (GET) skip validation entirely — they write
 * nothing to attribute. Any failure to validate degrades to "no playbook".
 */
export const withDeclaredPlaybook = async <T>(
  request: { method: string; headers: Headers },
  fn: () => Promise<T>,
): Promise<T> => {
  if (READ_METHODS.has(request.method.toUpperCase())) return fn();
  const ref = parsePlaybookRef(request.headers.get(BUSABASE_PLAYBOOK_HEADER));
  if (!ref) return fn();
  let playbook: BusabasePlaybookProvenance | null = null;
  try {
    playbook = await resolveDeclaredPlaybook(ref);
  } catch (error) {
    // Attribution is best-effort metadata: a lookup failure must not turn a
    // valid write into an error.
    console.warn("[busabase] could not validate x-busabase-playbook; dropping it", error);
  }
  if (!playbook) return fn();
  const channel = getContextSourceProvenance() ? null : sniffChannel(request.headers);
  return runWithContextPlaybook(playbook, fn, channel ? { channel } : undefined);
};

const hiddenPlaybook = (kind: PlaybookAttributionVO["kind"]): PlaybookAttributionVO => ({
  kind,
  accessible: false,
  nodeId: null,
  key: null,
  nodeType: null,
  nodeSlug: null,
  label: null,
});

/**
 * Narrow every stored playbook on `items` to what the CURRENT reader may see,
 * in place, with ONE query for the whole list (no N+1). A playbook node the
 * reader cannot read — or one since deleted — collapses to `{ kind,
 * accessible: false }` with every identifying field null. A readable one gets
 * its current type/slug so the link follows a rename. Items without a
 * playbook are untouched and cost nothing.
 */
export const applyPlaybookAttributionVisibility = async <
  T extends { sourceAttribution?: SourceAttributionVO | null },
>(
  items: T[],
): Promise<T[]> => {
  const withPlaybook = items.filter(
    (item) =>
      item.sourceAttribution?.playbook?.accessible && item.sourceAttribution.playbook.nodeId,
  );
  if (withPlaybook.length === 0) return items;

  const nodeIds = [
    ...new Set(withPlaybook.map((item) => item.sourceAttribution?.playbook?.nodeId as string)),
  ];
  const db = await getDb();
  const rows = await db
    .select({ id: busabaseNodes.id, type: busabaseNodes.type, slug: busabaseNodes.slug })
    .from(busabaseNodes)
    .where(
      and(
        inArray(busabaseNodes.id, nodeIds),
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        isNull(busabaseNodes.deletedAt),
        buildNodeVisibilityCondition(db),
      ),
    );
  const visible = new Map(rows.map((row) => [row.id, row]));

  for (const item of withPlaybook) {
    const attribution = item.sourceAttribution as SourceAttributionVO;
    const playbook = attribution.playbook as PlaybookAttributionVO;
    const node = visible.get(playbook.nodeId as string);
    attribution.playbook = node
      ? { ...playbook, nodeType: node.type, nodeSlug: node.slug }
      : hiddenPlaybook(playbook.kind);
  }
  return items;
};
