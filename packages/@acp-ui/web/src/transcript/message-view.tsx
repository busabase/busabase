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
import { Shimmer } from "kui/ai-elements/shimmer";
import { Fragment, type ReactNode } from "react";
import { AcpResourceContextChip } from "../composer/context-chip";
import { citationMarkdown, citationPresentation } from "./citations";
import { AcpContentView } from "./content-view";
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
  renderAttachment,
}: {
  messageId: string;
  attachments: AcpAttachment[];
  renderAttachment?: AcpMessageViewProps["renderAttachment"];
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

  const indexed = attachments.map((attachment, index) => ({
    attachment,
    index,
    custom: renderAttachment?.(attachment, index),
  }));
  const defaults = indexed.filter(({ custom }) => custom === undefined);
  const images = defaults.filter(({ attachment }) => attachment.mimeType.startsWith("image/"));
  const rest = defaults.filter(({ attachment }) => !attachment.mimeType.startsWith("image/"));

  return (
    <div className="mt-2 space-y-2">
      {indexed
        .filter(({ custom }) => custom !== undefined)
        .map(({ custom, index }) => (
          <Fragment key={`${messageId}-attachment-${index}`}>{custom}</Fragment>
        ))}
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
export function AcpMessageView({
  block,
  streaming = false,
  Markdown,
  reasoningLabel,
  citationLabels,
  resolveResource,
  resourceLabels,
  renderAttachment,
}: AcpMessageViewProps) {
  if (
    !block.text &&
    !block.attachments?.length &&
    !block.content?.some((item) => item.type !== "text" || item.text.length > 0)
  )
    return null;
  const citations = streaming
    ? { kind: "absent" as const, citations: [] }
    : citationPresentation(block);
  let textOffset = 0;
  let runOffset = 0;
  let runIndex = 0;
  let textRun = "";
  const content: ReactNode[] | undefined = block.content ? [] : undefined;
  const flushText = () => {
    if (!textRun) return;
    const projected =
      citations.kind === "valid"
        ? citationMarkdown(textRun, citations.citations, runOffset)
        : textRun;
    content?.push(<Markdown key={`${block.id}:${runIndex}`}>{projected}</Markdown>);
    textRun = "";
  };
  let attachmentIndex = 0;
  block.content?.forEach((item, index) => {
    if (item.type === "text") {
      if (!textRun) {
        runOffset = textOffset;
        runIndex = index;
      }
      textRun += item.text;
      textOffset += item.text.length;
      return;
    }
    if (
      citations.kind === "valid" &&
      item.type === "resource_link" &&
      citations.citations.some(
        (citation) => citation.sourceId === item._meta?.["bunny-agent/sourceId"],
      )
    )
      return;
    flushText();
    // The reducer keeps the attachment projection in the same order as the
    // corresponding media/resources in canonical content. Use that projection
    // for host cards while retaining content order and the fidelity defaults.
    const isAttachment = item.type === "image" || item.type === "audio" || item.type === "resource";
    const projectedIndex = attachmentIndex;
    if (isAttachment) attachmentIndex += 1;
    const attachment = isAttachment ? block.attachments?.[projectedIndex] : undefined;
    const marker = item.type === "resource" ? item._meta?.["acp-ui.resourceContext"] : undefined;
    const context =
      item.type === "resource" &&
      "text" in item.resource &&
      marker &&
      typeof marker === "object" &&
      "id" in marker &&
      typeof marker.id === "string" &&
      "name" in marker &&
      typeof marker.name === "string"
        ? {
            id: marker.id,
            name: marker.name,
            uri: item.resource.uri,
            mimeType: item.resource.mimeType ?? "text/plain",
            text: item.resource.text,
          }
        : undefined;
    const hostAttachment = attachment ? renderAttachment?.(attachment, projectedIndex) : undefined;
    const custom =
      hostAttachment !== undefined ? (
        hostAttachment
      ) : context ? (
        <div
          key={`${block.id}:context:${index}`}
          className="my-2 flex min-w-0 flex-wrap items-center gap-2"
        >
          <AcpResourceContextChip
            context={context}
            inspectLabel={resourceLabels?.preview}
            contentLabel={resourceLabels?.preview}
          />
        </div>
      ) : undefined;
    content?.push(
      custom !== undefined ? (
        <Fragment key={`${block.id}:${index}`}>{custom}</Fragment>
      ) : (
        <AcpContentView
          key={`${block.id}:${index}`}
          content={item}
          Markdown={Markdown}
          resolveResource={resolveResource}
          resourceLabels={resourceLabels}
        />
      ),
    );
  });
  flushText();
  if (block.variant === "thought") {
    return (
      <Reasoning isStreaming={streaming} data-testid="acp-thought">
        <ReasoningTrigger
          getThinkingMessage={
            reasoningLabel
              ? (isStreaming, duration) => {
                  if (isStreaming || duration === 0) {
                    return <Shimmer duration={1}>{reasoningLabel.thinking}</Shimmer>;
                  }
                  return duration === undefined
                    ? reasoningLabel.brief
                    : reasoningLabel.duration(duration);
                }
              : undefined
          }
        />
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
      <MessageContent className="[overflow-wrap:anywhere] [&_p]:[overflow-wrap:anywhere]">
        {/* An attachment-only message has empty text — skip the markdown
            render rather than let it emit an empty paragraph node. */}
        {content ? (
          content
        ) : (
          <>
            {block.text && <Markdown>{block.text}</Markdown>}
            {block.attachments && block.attachments.length > 0 && (
              <AcpAttachmentsView
                attachments={block.attachments}
                messageId={block.id}
                renderAttachment={renderAttachment}
              />
            )}
          </>
        )}
        {citations.kind === "valid" && citations.citations.length > 0 ? (
          <details className="mt-2 text-xs" data-testid="acp-citations">
            <summary className="cursor-pointer text-muted-foreground">
              {citationLabels?.sources ?? "Sources"}
              {citations.partial ? ` · ${citationLabels?.partial ?? "Partial"}` : ""}
            </summary>
            <ol className="mt-2 space-y-2">
              {citations.citations.map((citation, index) => (
                <li
                  key={`${citation.sourceId}:${index}`}
                  data-citation-start={citation.start}
                  data-citation-end={citation.end}
                >
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-words text-primary underline"
                  >
                    {citation.title || citation.url}
                  </a>
                  <blockquote className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-muted-foreground">
                    {citation.quote}
                  </blockquote>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </MessageContent>
    </Message>
  );
}
