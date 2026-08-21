"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import { Attachment, AttachmentPreview, Attachments } from "kui/ai-elements/attachments";
import { Message, MessageContent } from "kui/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "kui/ai-elements/reasoning";
import type { AcpMessageViewProps } from "./slots";

/**
 * Renders through `kui`'s `Attachments`/`Attachment`, which are typed against
 * the AI SDK's `FileUIPart` — a structural shape, not an `ai` import of our
 * own (`src/__tests__/boundary.test.ts` enforces that distinction, same as
 * `tool-status.ts`'s seam onto `ToolUIPart["state"]`). ACP's `data`/`mimeType`
 * become a `data:` URL, since ACP sends the payload inline, base64, with no
 * separate URL of its own.
 */
function AcpAttachmentsView({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: AcpAttachment[];
}) {
  return (
    <Attachments className="mt-2" variant="grid">
      {attachments.map((attachment, index) => (
        <Attachment
          data={{
            id: `${messageId}-attachment-${index}`,
            type: "file",
            mediaType: attachment.mimeType,
            url: `data:${attachment.mimeType};base64,${attachment.data}`,
          }}
          // biome-ignore lint/suspicious/noArrayIndexKey: the reducer only ever appends to a message's attachments array, never reorders or removes — index is a stable identity here, and attachments carry no id of their own to key on instead.
          key={`${messageId}-attachment-${index}`}
        >
          <AttachmentPreview />
        </Attachment>
      ))}
    </Attachments>
  );
}

/**
 * One message bubble, or one collapsible reasoning panel.
 *
 * ACP distinguishes `agent_thought_chunk` from `agent_message_chunk`, and the
 * core keeps that distinction as `variant`. Rendering thoughts through kui's
 * `Reasoning` gives them the collapsed-by-default, "Thought for N seconds"
 * treatment instead of an italic paragraph the user cannot dismiss.
 */
export function AcpMessageView({ block, streaming = false, Markdown }: AcpMessageViewProps) {
  if (block.variant === "thought") {
    return (
      <Reasoning isStreaming={streaming} data-testid="acp-thought">
        <ReasoningTrigger />
        <ReasoningContent>{block.text}</ReasoningContent>
      </Reasoning>
    );
  }

  return (
    <Message
      // ACP says "agent"; kui speaks the AI SDK's role vocabulary, where the
      // non-user side is "assistant". Purely a naming difference — it decides
      // which side of the conversation the bubble sits on.
      from={block.role === "user" ? "user" : "assistant"}
      data-testid={`acp-message-${block.role}`}
    >
      <MessageContent>
        {/* An attachment-only message has empty text — skip the markdown
            render rather than let it emit an empty paragraph node. */}
        {block.text && <Markdown>{block.text}</Markdown>}
        {block.attachments && block.attachments.length > 0 && (
          <AcpAttachmentsView attachments={block.attachments} messageId={block.id} />
        )}
      </MessageContent>
    </Message>
  );
}
