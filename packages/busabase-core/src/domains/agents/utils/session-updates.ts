/**
 * Pure, isomorphic helpers for turning an ACP `session/update` payload into
 * something a chat UI can render. No React, no server imports — safe for both
 * the OSS desktop UI and (eventually) the mobile client.
 */
import type {
  AgentPermissionRequestVO,
  AgentSessionEventVO,
} from "busabase-contract/domains/agents/types";

export interface RenderableMessage {
  role: "user" | "agent" | "note";
  text: string;
}

/** Pull renderable text out of an ACP `session/update`, whose shape varies by agent. */
export function updateToText(update: unknown): RenderableMessage | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, unknown>;
  const tag = typeof u.sessionUpdate === "string" ? u.sessionUpdate : "";

  if (tag === "user_message" && typeof u.text === "string") {
    return { role: "user", text: u.text };
  }
  if (tag === "agent_message_chunk" || tag === "agent_thought_chunk") {
    const content = u.content as Record<string, unknown> | undefined;
    const text = typeof content?.text === "string" ? content.text : "";
    return text ? { role: "agent", text } : null;
  }
  if (tag === "permission_auto_approved") {
    return { role: "note", text: "A tool call was auto-approved (no approval UI yet)." };
  }
  // Busabase's own note, not an ACP tag — used for things the user must be told
  // about the *session* rather than the conversation (e.g. this agent cannot
  // take an HTTP MCP server, so it has no access to workspace data).
  if (tag === "note" && typeof u.text === "string") {
    return { role: "note", text: u.text };
  }
  if (tag === "tool_call" || tag === "tool_call_update") {
    const title = typeof u.title === "string" ? u.title : u.rawInput ? "tool call" : "";
    return title ? { role: "note", text: `Tool: ${title}` } : null;
  }
  return null;
}

/**
 * Collapse consecutive agent chunks into one bubble so a streamed reply reads
 * as a sentence rather than one box per token.
 */
export function collapseAgentEvents(
  events: { kind: string; acpUpdate?: unknown }[],
): RenderableMessage[] {
  const messages: RenderableMessage[] = [];
  for (const event of events) {
    const parsed = event.kind === "acpUpdate" ? updateToText(event.acpUpdate) : null;
    if (!parsed) continue;
    const last = messages.at(-1);
    if (last && last.role === parsed.role && parsed.role === "agent") {
      last.text += parsed.text;
    } else {
      messages.push({ ...parsed });
    }
  }
  return messages;
}

/**
 * Merge the token-level `agent_message_chunk` events of one turn into a single
 * event before they are written to the database.
 *
 * Agents stream at token granularity — one measured turn produced 26 events
 * for a three-line reply, 15 of them single-token chunks — so persisting the
 * raw stream would be an INSERT per token, against an embedded PGLite on the
 * desktop build. Every reader (the timeline, session history, audit) wants the
 * assembled message anyway, so the collapse belongs on the write side.
 *
 * `seq` is taken from the FIRST chunk of each run: replay is `seq > afterSeq`,
 * so a client that already saw the start of a message must not be handed the
 * whole assembled message again under a later `seq`.
 */
export function collapseForPersistence(events: AgentSessionEventVO[]): AgentSessionEventVO[] {
  const out: AgentSessionEventVO[] = [];
  for (const event of events) {
    const update = event.acpUpdate as { sessionUpdate?: unknown; content?: unknown } | undefined;
    const isChunk = event.kind === "acpUpdate" && update?.sessionUpdate === "agent_message_chunk";
    const previous = out.at(-1);
    const previousUpdate = previous?.acpUpdate as
      | { sessionUpdate?: unknown; content?: { text?: unknown } }
      | undefined;

    if (
      isChunk &&
      previous?.kind === "acpUpdate" &&
      previousUpdate?.sessionUpdate === "agent_message_chunk"
    ) {
      const text = (update?.content as { text?: unknown } | undefined)?.text;
      if (typeof text === "string" && typeof previousUpdate.content?.text === "string") {
        previousUpdate.content.text += text;
        continue;
      }
    }
    // Cloned so appending to `content.text` above never mutates the live
    // in-memory buffer the UI is still streaming from.
    out.push(isChunk ? structuredClone(event) : event);
  }
  return out;
}

export type TimelineItem =
  | { kind: "message"; role: "user" | "agent" | "note"; text: string }
  | { kind: "permission"; request: AgentPermissionRequestVO; resolvedOptionId?: string };

/**
 * The full transcript, in order: text bubbles interleaved with permission
 * cards exactly where they happened, each permission card carrying its
 * resolution (if any) so the UI can render it as answered rather than as a
 * second, contradictory pending card once `permissionResolved` arrives.
 */
export function buildAgentTimeline(events: AgentSessionEventVO[]): TimelineItem[] {
  const resolvedByRequestId = new Map<string, string>();
  for (const event of events) {
    if (
      event.kind === "permissionResolved" &&
      event.permissionRequestId &&
      event.permissionOptionId
    ) {
      resolvedByRequestId.set(event.permissionRequestId, event.permissionOptionId);
    }
  }

  const items: TimelineItem[] = [];
  for (const event of events) {
    if (event.kind === "acpUpdate") {
      const parsed = updateToText(event.acpUpdate);
      if (!parsed) continue;
      const last = items.at(-1);
      if (last?.kind === "message" && last.role === parsed.role && parsed.role === "agent") {
        last.text += parsed.text;
      } else if (
        // ACP reports one `tool_call` plus a `tool_call_update` per status
        // change, all carrying the same title, so a single call rendered as up
        // to six identical "Tool: X" rows. Harmless when a session made two
        // tool calls; unreadable now that injected MCP tools mean a routine
        // turn makes a dozen. Collapse the repeats rather than dropping
        // `tool_call_update`, which is also what carries a title the initial
        // `tool_call` sometimes omits.
        last?.kind === "message" &&
        last.role === "note" &&
        parsed.role === "note" &&
        last.text === parsed.text
      ) {
        // Same tool, same title, still the same call — nothing new to show.
      } else {
        items.push({ kind: "message", ...parsed });
      }
    } else if (event.kind === "permissionRequest" && event.permissionRequest) {
      items.push({
        kind: "permission",
        request: event.permissionRequest,
        resolvedOptionId: resolvedByRequestId.get(event.permissionRequest.requestId),
      });
    }
  }
  return items;
}
