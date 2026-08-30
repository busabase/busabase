"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "kui/ai-elements/attachments";
import { Message, MessageContent } from "kui/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "kui/ai-elements/reasoning";
import type { AcpMessageViewProps } from "./slots";

/**
 * Renders through `kui`'s `Attachments`/`Attachment`, which are typed against
 * the AI SDK's `FileUIPart` — a structural shape, not an `ai` import of our
 * own (`src/__tests__/boundary.test.ts` enforces that distinction, same as
 * `tool-status.ts`'s seam onto `ToolUIPart["state"]`).
 *
 * Images become a `data:` URL, since ACP sends the payload inline, base64,
 * with no separate URL of its own, and grid thumbnails identify them on their
 * own. Everything else — a PDF, a spreadsheet, an attached source file —
 * renders through the `inline` variant instead, because kui's `grid` variant
 * deliberately drops `AttachmentInfo` and a document without its name is an
 * anonymous file icon. Those also skip the `data:` URL entirely: nothing
 * displays it, and materialising one would double a multi-megabyte payload in
 * memory for no visible gain.
 */
function AcpAttachmentsView({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: AcpAttachment[];
}) {
  const toData = (attachment: AcpAttachment, index: number) => {
    const isImage = attachment.mimeType.startsWith("image/");
    return {
      id: `${messageId}-attachment-${index}`,
      type: "file" as const,
      mediaType: attachment.mimeType,
      url: isImage ? `data:${attachment.mimeType};base64,${attachment.data}` : "",
      ...(attachment.filename ? { filename: attachment.filename } : {}),
    };
  };

  const indexed = attachments.map((attachment, index) => ({ attachment, index }));
  const images = indexed.filter(({ attachment }) => attachment.mimeType.startsWith("image/"));
  const rest = indexed.filter(({ attachment }) => !attachment.mimeType.startsWith("image/"));

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 ? (
        <Attachments variant="grid">
          {images.map(({ attachment, index }) => (
            <Attachment data={toData(attachment, index)} key={`${messageId}-attachment-${index}`}>
              <AttachmentPreview />
            </Attachment>
          ))}
        </Attachments>
      ) : null}
      {rest.length > 0 ? (
        <Attachments variant="inline">
          {rest.map(({ attachment, index }) => (
            <Attachment data={toData(attachment, index)} key={`${messageId}-attachment-${index}`}>
              <AttachmentPreview />
              <AttachmentInfo className="max-w-40" />
            </Attachment>
          ))}
        </Attachments>
      ) : null}
    </div>
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
