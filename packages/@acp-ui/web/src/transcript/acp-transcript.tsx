"use client";

import { groupConsecutiveToolCalls } from "@acp-ui/core/group";
import type { AcpBlock, AcpPermissionBlock } from "@acp-ui/core/reduce";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "kui/ai-elements/conversation";
import { Response } from "kui/ai-elements/response";
import type { ToolPart } from "kui/ai-elements/tool";
import type { ReactNode } from "react";
import { AcpMessageView } from "./message-view";
import { AcpNoteView } from "./note-view";
import { AcpPermissionView } from "./permission-view";
import type { AcpReasoningLabels, AcpTranscriptSlots } from "./slots";
import { AcpToolCallView } from "./tool-call-view";
import { type AcpToolRunLabels, AcpToolRunView } from "./tool-run-view";

export interface AcpTranscriptLabels {
  permissionAnswered?: string;
  permissionTimeout?: (count: number) => string;
  permissionTimingOut?: string;
  tools?: AcpToolRunLabels;
  reasoning?: AcpReasoningLabels;
  toolStatuses?: Partial<Record<ToolPart["state"], string>>;
}

export interface AcpTranscriptProps {
  blocks: readonly AcpBlock[];
  /** Called with the block and the option the user picked. */
  onAnswerPermission: (block: AcpPermissionBlock, optionId: string) => void;
  /** True while a turn is in flight — drives the reasoning panel's live state. */
  streaming?: boolean;
  slots?: AcpTranscriptSlots;
  className?: string;
  labels?: AcpTranscriptLabels;
}

/**
 * The block list, with no scroll container of its own.
 *
 * Kept separate from `AcpConversation` so a host can swap its renderer first
 * and adopt kui's stick-to-bottom behaviour as a second, independently
 * verifiable step — `StickToBottom` needs a height-bounded parent, which an
 * existing layout may not provide.
 */
export function AcpTranscript({
  blocks,
  onAnswerPermission,
  streaming = false,
  slots = {},
  className,
  labels,
}: AcpTranscriptProps) {
  const Markdown = slots.Markdown ?? Response;
  const MessageView = slots.Message ?? AcpMessageView;
  const ToolCallView = slots.ToolCall ?? AcpToolCallView;
  const PermissionView = slots.Permission ?? AcpPermissionView;
  const NoteView = slots.Note ?? AcpNoteView;

  const ToolRunView = slots.ToolRun ?? AcpToolRunView;
  // Reference equality, not id comparison: `groupConsecutiveToolCalls` groups
  // the SAME block objects `blocks` holds, never clones, so this correctly
  // identifies the tail regardless of whether it ends up rendered solo or
  // inside a run.
  const tail = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;

  const renderSingle = (block: AcpBlock) => {
    // Only the tail block can still be receiving chunks.
    const isTail = streaming && block === tail;
    switch (block.kind) {
      case "message":
        return (
          <MessageView
            key={block.id}
            block={block}
            streaming={isTail}
            Markdown={Markdown}
            reasoningLabel={labels?.reasoning}
          />
        );
      case "tool_call":
        return <ToolCallView key={block.id} block={block} statusLabels={labels?.toolStatuses} />;
      case "permission":
        return (
          <PermissionView
            key={block.id}
            block={block}
            onAnswer={(optionId) => onAnswerPermission(block, optionId)}
            answeredLabel={labels?.permissionAnswered}
            timeoutLabel={labels?.permissionTimeout}
            timingOutLabel={labels?.permissionTimingOut}
          />
        );
      case "note":
        return <NoteView key={block.id} block={block} />;
      default: {
        // `AcpBlock` is a closed union, so this is unreachable. The `never`
        // assignment is what makes adding a block kind to the core a compile
        // error here rather than a silently blank row — a bare `return null`
        // would have swallowed it.
        const unhandled: never = block;
        void unhandled;
        return null;
      }
    }
  };

  return (
    <div className={className}>
      {groupConsecutiveToolCalls(blocks).map((group) =>
        group.kind === "run" ? (
          <ToolRunView
            blocks={group.blocks}
            key={group.blocks.map((b) => b.id).join(":")}
            labels={labels?.tools}
            statusLabels={labels?.toolStatuses}
          />
        ) : (
          renderSingle(group.block)
        ),
      )}
    </div>
  );
}

export interface AcpConversationProps extends AcpTranscriptProps {
  emptyTitle?: string;
  emptyDescription?: string;
  /** Host-owned activity rendered after the transcript, inside the scroll surface. */
  activity?: ReactNode;
}

/**
 * The full chat surface: the transcript inside kui's stick-to-bottom
 * conversation, with the scroll-to-latest button. This is the buda-shaped
 * container — neither ACP implementation had auto-scroll before.
 */
export function AcpConversation({
  emptyTitle,
  emptyDescription,
  activity,
  className,
  ...props
}: AcpConversationProps) {
  return (
    <Conversation className={className}>
      <ConversationContent>
        {props.blocks.length === 0 && !activity ? (
          (props.slots?.empty ?? (
            <ConversationEmptyState title={emptyTitle} description={emptyDescription} />
          ))
        ) : (
          <div className="flex flex-col gap-4">
            {props.blocks.length > 0 ? (
              <AcpTranscript {...props} className="flex flex-col gap-4" />
            ) : null}
            {activity}
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
