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
