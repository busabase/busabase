import type { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk";
import type {
  AcpAttachment,
  AcpBlock,
  AcpMessageBlock,
  AcpPermissionBlock,
  AcpToolCallBlock,
  AcpUiEvent,
} from "./types";

/**
 * Reduces one ACP event into the conversation view model.
 *
 * **The same function serves both consumers**, which is the point: acprouter
 * streams events live, busabase folds a persisted array to rebuild a session.
 * Live = call this per event as it arrives. Replay = `events.reduce(...)`.
 * Both must produce identical output, which `reduce-acp-event.test.ts` pins.
 *
 * Pure: no mutation of `blocks`, no clock, no IO.
 */
export function reduceAcpEvent(blocks: readonly AcpBlock[], event: AcpUiEvent): AcpBlock[] {
  switch (event.type) {
    case "session_update":
      return reduceSessionUpdate(blocks, event.update);

    case "permission_request": {
      const block: AcpPermissionBlock = {
        kind: "permission",
        id: event.requestId,
        title: event.title,
        options: event.options,
        ...(event.timeoutAt ? { timeoutAt: event.timeoutAt } : {}),
        resolution: "pending",
      };
      return [...blocks, block];
    }

    case "permission_answering":
      return updatePermission(blocks, event.requestId, (b) =>
        // Only an unanswered request can move to "answering" — a late click on
        // an already-resolved card must not reopen it.
        b.resolution === "pending" ? { ...b, resolution: "answering" } : b,
      );

    case "permission_resolved":
      return updatePermission(blocks, event.requestId, (b) => ({
        ...b,
        resolution: { optionId: event.optionId },
      }));

    case "note":
      return [
        ...blocks,
        {
          kind: "note",
          id: `note-${blocks.length}`,
          text: event.text,
          ...(event.ended ? { ended: true } : {}),
        },
      ];

    default:
      return blocks as AcpBlock[];
  }
}

/** Fold a whole batch — the replay path. Equivalent to feeding them one by one. */
export function reduceAcpEvents(
  blocks: readonly AcpBlock[],
  events: readonly AcpUiEvent[],
): AcpBlock[] {
  return events.reduce<AcpBlock[]>(
    (acc, event) => reduceAcpEvent(acc, event),
    blocks as AcpBlock[],
  );
}

function reduceSessionUpdate(blocks: readonly AcpBlock[], update: SessionUpdate): AcpBlock[] {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      return appendChunk(blocks, update.content, "user", "message", update.messageId ?? undefined);
    case "agent_message_chunk":
      return appendChunk(blocks, update.content, "agent", "message", update.messageId ?? undefined);
    case "agent_thought_chunk":
      return appendChunk(blocks, update.content, "agent", "thought", update.messageId ?? undefined);

    case "tool_call": {
      const block: AcpToolCallBlock = {
        kind: "tool_call",
        id: update.toolCallId,
        title: update.title,
        toolKind: update.kind ?? null,
        status: update.status ?? "pending",
      };
      // A `tool_call` for an id we've already seen is a re-announcement, not a
      // second call — merge rather than duplicate.
      const existing = blocks.findIndex(
        (b) => b.kind === "tool_call" && b.id === update.toolCallId,
      );
      if (existing !== -1) {
        return replaceAt(blocks, existing, { ...(blocks[existing] as AcpToolCallBlock), ...block });
      }
      return [...blocks, block];
    }

    case "tool_call_update": {
      const index = blocks.findIndex((b) => b.kind === "tool_call" && b.id === update.toolCallId);
      if (index === -1) {
        // An update for a call whose creation we never saw — the session was
        // joined mid-turn. Render what we have rather than dropping it.
        const block: AcpToolCallBlock = {
          kind: "tool_call",
          id: update.toolCallId,
          title: update.title ?? update.toolCallId,
          toolKind: update.kind ?? null,
          status: update.status ?? "pending",
        };
        return [...blocks, block];
      }
      const prev = blocks[index] as AcpToolCallBlock;
      return replaceAt(blocks, index, {
        ...prev,
        // `tool_call_update` often carries only the changed fields, and is also
        // what supplies a title the initial `tool_call` sometimes omits.
        title: update.title ?? prev.title,
        toolKind: update.kind ?? prev.toolKind,
        status: update.status ?? prev.status,
      });
    }

    // plan / plan_update / plan_removed / available_commands_update /
    // current_mode_update / config_option_update / session_info_update /
    // usage_update — no renderer asks for these yet, and neither implementation
    // this replaces rendered them. Ignored deliberately rather than surfaced as
    // unreadable JSON; a test pins this so adding one later is a decision, not
    // an accident.
    default:
      return blocks as AcpBlock[];
  }
}

function textOf(content: ContentBlock): string | null {
  return content.type === "text" && typeof content.text === "string" ? content.text : null;
}

/**
 * Images, audio and embedded resources become `AcpAttachment`s.
 *
 * A `resource` arrives as either `TextResourceContents` or
 * `BlobResourceContents`; `AcpAttachment.data` is uniformly base64, so a text
 * resource is re-encoded here rather than stored in a second representation
 * the renderers would each have to branch on. `resource_link` stays out of
 * scope (see `AcpAttachment`'s doc comment) and, like the eight unhandled
 * `sessionUpdate` kinds, falls through as neither text nor an attachment —
 * silently ignored rather than surfaced as unreadable JSON.
 */
function attachmentOf(content: ContentBlock): AcpAttachment | null {
  if (content.type === "image" || content.type === "audio") {
    return { kind: content.type, data: content.data, mimeType: content.mimeType };
  }
  if (content.type === "resource") {
    const resource = content.resource;
    const filename = filenameFromUri(resource.uri);
    const mimeType = resource.mimeType ?? "application/octet-stream";
    if ("text" in resource) {
      return { kind: "file", data: encodeUtf8Base64(resource.text), mimeType, filename };
    }
    return { kind: "file", data: resource.blob, mimeType, filename };
  }
  return null;
}

/** The trailing path segment of a resource `uri`, percent-decoded, for display. */
function filenameFromUri(uri: string): string | undefined {
  const withoutQuery = uri.split(/[?#]/)[0] ?? "";
  const last = withoutQuery.split("/").pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last;
  }
}

function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function appendChunk(
  blocks: readonly AcpBlock[],
  content: ContentBlock,
  role: AcpMessageBlock["role"],
  variant: AcpMessageBlock["variant"],
  messageId?: string,
): AcpBlock[] {
  const text = textOf(content);
  const attachment = text === null ? attachmentOf(content) : null;
  if (text === null && attachment === null) return blocks as AcpBlock[];

  const last = blocks[blocks.length - 1];
  if (last?.kind === "message" && canMerge(last, role, variant, messageId)) {
    const merged: AcpMessageBlock = {
      ...last,
      ...(text !== null ? { text: last.text + text } : {}),
      ...(attachment ? { attachments: [...(last.attachments ?? []), attachment] } : {}),
    };
    return replaceAt(blocks, blocks.length - 1, merged);
  }

  return [
    ...blocks,
    {
      kind: "message",
      // Stable and derivable from position — no clock, no randomness, so replay
      // produces byte-identical ids to the live path.
      id: messageId ?? `${role}-${variant}-${blocks.length}`,
      role,
      variant,
      // An attachment-only chunk (no text ever arrived for this message) still
      // needs a defined `text` — empty, not missing, so every reader can keep
      // assuming `string` rather than `string | undefined`.
      text: text ?? "",
      ...(attachment ? { attachments: [attachment] } : {}),
      ...(messageId ? { messageId } : {}),
    },
  ];
}

/**
 * Whether a chunk continues the previous block.
 *
 * When the agent sends `messageId`, ACP says it is authoritative: same id =
 * same message, changed id = new message. Agents that omit it fall back to
 * (role, variant) adjacency, which is what both existing implementations use.
 */
function canMerge(
  last: AcpMessageBlock,
  role: AcpMessageBlock["role"],
  variant: AcpMessageBlock["variant"],
  messageId?: string,
): boolean {
  if (last.role !== role || last.variant !== variant) return false;
  if (messageId !== undefined || last.messageId !== undefined) return last.messageId === messageId;
  return true;
}

function updatePermission(
  blocks: readonly AcpBlock[],
  requestId: string,
  update: (block: AcpPermissionBlock) => AcpPermissionBlock,
): AcpBlock[] {
  const index = blocks.findIndex((b) => b.kind === "permission" && b.id === requestId);
  if (index === -1) return blocks as AcpBlock[];
  return replaceAt(blocks, index, update(blocks[index] as AcpPermissionBlock));
}

function replaceAt(blocks: readonly AcpBlock[], index: number, block: AcpBlock): AcpBlock[] {
  return [...blocks.slice(0, index), block, ...blocks.slice(index + 1)];
}
