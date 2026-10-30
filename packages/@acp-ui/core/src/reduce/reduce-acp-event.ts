import type { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk";
import { currentContext, reduceLifecycle } from "./lifecycle";
import type {
  AcpAttachment,
  AcpBlock,
  AcpInputBlock,
  AcpMessageBlock,
  AcpPermissionBlock,
  AcpToolCallBlock,
  AcpUiEvent,
} from "./types";

/** One pure reduction is used for live delivery and persisted replay. */
export function reduceAcpEvent(blocks: readonly AcpBlock[], event: AcpUiEvent): AcpBlock[] {
  switch (event.type) {
    case "session_update":
      return reduceSessionUpdate(blocks, event.update);
    case "lifecycle":
      return reduceLifecycle(blocks, event.event);
    case "interrupted": {
      const running = blocks.findLast(
        (block) => block.kind === "turn" && block.status === "running",
      );
      return running?.kind === "turn"
        ? reduceLifecycle(blocks, {
            version: 1,
            type: "turn_finished",
            turnId: running.id,
            at: event.at,
            stopReason: "interrupted",
          })
        : (blocks as AcpBlock[]);
    }
    case "permission_request": {
      const existing = blocks.findIndex(
        (block) => block.kind === "permission" && block.id === event.requestId,
      );
      if (existing !== -1) return blocks as AcpBlock[];
      const block: AcpPermissionBlock = {
        kind: "permission",
        id: event.requestId,
        title: event.title,
        options: event.options,
        ...(event.timeoutAt ? { timeoutAt: event.timeoutAt } : {}),
        ...currentContext(blocks),
        resolution: "pending",
      };
      return [...blocks, block];
    }
    case "permission_answering":
      return updatePermission(blocks, event.requestId, (block) =>
        block.resolution === "pending"
          ? {
              ...block,
              resolution: "answering",
              ...(event.optionId ? { submittedOptionId: event.optionId } : {}),
              confirmationUnknown: false,
              error: undefined,
            }
          : block,
      );
    case "permission_failed":
      return updatePermission(blocks, event.requestId, (block) =>
        block.resolution === "pending" || block.resolution === "answering"
          ? {
              ...block,
              resolution: "pending",
              error: event.error,
              confirmationUnknown: event.confirmationUnknown ?? false,
            }
          : block,
      );
    case "permission_resolved":
      return updatePermission(blocks, event.requestId, (block) =>
        block.resolution === "cancelled"
          ? block
          : {
              ...block,
              resolution: { optionId: event.optionId },
              confirmationUnknown: false,
              error: undefined,
            },
      );
    case "permission_cancelled":
      return updatePermission(blocks, event.requestId, (block) =>
        block.resolution === "pending" || block.resolution === "answering"
          ? { ...block, resolution: "cancelled", confirmationUnknown: false, error: undefined }
          : block,
      );
    case "input_request": {
      const existing = blocks.findIndex(
        (block) => block.kind === "input_request" && block.id === event.requestId,
      );
      if (existing !== -1) return blocks as AcpBlock[];
      return [
        ...blocks,
        {
          kind: "input_request",
          id: event.requestId,
          message: event.message,
          requestedSchema: event.requestedSchema,
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          ...currentContext(blocks),
          resolution: "pending",
        },
      ];
    }
    case "input_answering":
      return updateInput(blocks, event.requestId, (block) =>
        block.resolution === "pending"
          ? {
              ...block,
              resolution: "answering",
              ...(event.response ? { submittedResponse: event.response } : {}),
              confirmationUnknown: false,
              error: undefined,
            }
          : block,
      );
    case "input_resolved":
      return updateInput(blocks, event.requestId, (block) =>
        typeof block.resolution === "object" && block.resolution.action === "cancel"
          ? block
          : {
              ...block,
              resolution: {
                action: event.action,
                ...(event.content ? { content: event.content } : {}),
              },
              error: undefined,
              confirmationUnknown: false,
            },
      );
    case "input_failed":
      return updateInput(blocks, event.requestId, (block) =>
        typeof block.resolution === "string"
          ? {
              ...block,
              resolution: "pending",
              error: event.error,
              confirmationUnknown: event.confirmationUnknown ?? false,
            }
          : block,
      );
    case "note":
      return [
        ...blocks,
        {
          kind: "note",
          id: `note-${blocks.length}`,
          text: event.text,
          ...currentContext(blocks),
          ...(event.ended ? { ended: true } : {}),
        },
      ];
    default:
      return blocks as AcpBlock[];
  }
}

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
      return appendChunk(
        blocks,
        update.content,
        "user",
        "message",
        update.messageId ?? undefined,
        update._meta ?? undefined,
      );
    case "agent_message_chunk":
      return appendChunk(
        blocks,
        update.content,
        "agent",
        "message",
        update.messageId ?? undefined,
        update._meta ?? undefined,
      );
    case "agent_thought_chunk":
      return appendChunk(
        blocks,
        update.content,
        "agent",
        "thought",
        update.messageId ?? undefined,
        update._meta ?? undefined,
      );
    case "tool_call":
    case "tool_call_update": {
      const index = blocks.findIndex(
        (block) => block.kind === "tool_call" && block.id === update.toolCallId,
      );
      const previous = index === -1 ? undefined : (blocks[index] as AcpToolCallBlock);
      const block: AcpToolCallBlock = {
        kind: "tool_call",
        id: update.toolCallId,
        ...currentContext(blocks),
        ...previous,
        title: update.title ?? previous?.title ?? update.toolCallId,
        toolKind: update.kind ?? previous?.toolKind ?? null,
        status: update.status ?? previous?.status ?? "pending",
        ...toolFields(update),
      };
      return index === -1 ? [...blocks, block] : replaceAt(blocks, index, block);
    }
    case "plan": {
      if (!Array.isArray(update.entries)) return blocks as AcpBlock[];
      const context = currentContext(blocks);
      const id = `plan:${context.turnId ?? "session"}`;
      const index = blocks.findIndex((block) => block.kind === "plan" && block.id === id);
      const block: AcpBlock = { kind: "plan", id, entries: update.entries, ...context };
      return index === -1 ? [...blocks, block] : replaceAt(blocks, index, block);
    }
    default:
      // Metadata has its own state channel; unsupported updates remain in the
      // host's durable event log without becoming unreadable transcript JSON.
      return blocks as AcpBlock[];
  }
}

/** V1 tool updates are partial; null optional fields mean no new value. */
function toolFields(update: {
  name?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: AcpToolCallBlock["content"] | null;
  locations?: AcpToolCallBlock["locations"] | null;
  _meta?: Record<string, unknown> | null;
}): Partial<AcpToolCallBlock> {
  const parent = toolParentOf(update._meta);
  return {
    ...(update.name != null ? { name: update.name } : {}),
    ...(update.rawInput != null ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput != null ? { rawOutput: update.rawOutput } : {}),
    ...(update.content != null ? { content: update.content } : {}),
    ...(update.locations != null ? { locations: update.locations } : {}),
    ...(update._meta != null ? { _meta: update._meta } : {}),
    ...(parent !== undefined ? { parentToolCallId: parent } : {}),
  };
}

/** Normalize relationship facts without merging unrelated raw metadata. */
function toolParentOf(meta: Record<string, unknown> | null | undefined): string | null | undefined {
  const scoped = meta?.["buda.im"];
  const candidates = [
    meta?.parentToolCallId,
    meta?.["bunny-agent/parentToolCallId"],
    scoped && typeof scoped === "object" && "parentToolCallId" in scoped
      ? scoped.parentToolCallId
      : undefined,
  ];
  return candidates.find(
    (value): value is string | null =>
      value === null || (typeof value === "string" && value.length > 0),
  );
}

function attachmentOf(content: ContentBlock): AcpAttachment | null {
  if (content.type === "image" || content.type === "audio")
    return { kind: content.type, data: content.data, mimeType: content.mimeType };
  if (content.type !== "resource") return null;
  const resource = content.resource;
  const filename = filenameFromUri(resource.uri);
  const mimeType = resource.mimeType ?? "application/octet-stream";
  if ("text" in resource)
    return {
      kind: "file",
      data: encodeUtf8Base64(resource.text),
      mimeType,
      filename,
      resource: content,
    };
  return { kind: "file", data: resource.blob, mimeType, filename, resource: content };
}

function filenameFromUri(uri: string): string | undefined {
  const last = (uri.split(/[?#]/)[0] ?? "").split("/").pop();
  if (!last) return undefined;
  try {
    return decodeURIComponent(last) || undefined;
  } catch {
    return last;
  }
}

function encodeUtf8Base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function appendContent(previous: ContentBlock[], content: ContentBlock): ContentBlock[] {
  const last = previous.at(-1);
  if (
    last?.type === "text" &&
    content.type === "text" &&
    !last._meta &&
    !content._meta &&
    !last.annotations &&
    !content.annotations
  ) {
    return [...previous.slice(0, -1), { ...last, text: last.text + content.text }];
  }
  return [...previous, content];
}

function appendChunk(
  blocks: readonly AcpBlock[],
  content: ContentBlock,
  role: AcpMessageBlock["role"],
  variant: AcpMessageBlock["variant"],
  messageId?: string,
  metadata?: Record<string, unknown>,
): AcpBlock[] {
  if (metadata) content = { ...content, _meta: { ...content._meta, ...metadata } };
  const text = content.type === "text" ? content.text : null;
  const attachment = text === null ? attachmentOf(content) : null;
  const last = blocks.at(-1);
  const context = role === "agent" ? currentContext(blocks) : {};
  if (
    last?.kind === "message" &&
    canMerge(last, role, variant, messageId) &&
    last.turnId === context.turnId &&
    last.stepId === context.stepId
  ) {
    return replaceAt(blocks, blocks.length - 1, {
      ...last,
      ...(metadata ? { _meta: { ...last._meta, ...metadata } } : {}),
      ...(text !== null ? { text: last.text + text } : {}),
      ...(attachment ? { attachments: [...(last.attachments ?? []), attachment] } : {}),
      content: appendContent(
        last.content ?? (last.text ? [{ type: "text", text: last.text }] : []),
        content,
      ),
    });
  }
  return [
    ...blocks,
    {
      kind: "message",
      id: messageId ?? `${role}-${variant}-${blocks.length}`,
      role,
      variant,
      text: text ?? "",
      content: [content],
      ...(metadata ? { _meta: metadata } : {}),
      ...context,
      ...(attachment ? { attachments: [attachment] } : {}),
      ...(messageId ? { messageId } : {}),
    },
  ];
}

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
  id: string,
  update: (block: AcpPermissionBlock) => AcpPermissionBlock,
): AcpBlock[] {
  const index = blocks.findIndex((block) => block.kind === "permission" && block.id === id);
  return index === -1
    ? (blocks as AcpBlock[])
    : replaceAt(blocks, index, update(blocks[index] as AcpPermissionBlock));
}
function updateInput(
  blocks: readonly AcpBlock[],
  id: string,
  update: (block: AcpInputBlock) => AcpInputBlock,
): AcpBlock[] {
  const index = blocks.findIndex((block) => block.kind === "input_request" && block.id === id);
  return index === -1
    ? (blocks as AcpBlock[])
    : replaceAt(blocks, index, update(blocks[index] as AcpInputBlock));
}
function replaceAt(blocks: readonly AcpBlock[], index: number, block: AcpBlock): AcpBlock[] {
  return [...blocks.slice(0, index), block, ...blocks.slice(index + 1)];
}
