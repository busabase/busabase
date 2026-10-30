"use client";

import { groupConsecutiveToolCalls } from "@acp-ui/core/group";
import type {
  AcpBlock,
  AcpInputBlock,
  AcpInputResponse,
  AcpPermissionBlock,
} from "@acp-ui/core/reduce";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "kui/ai-elements/conversation";
import { Response } from "kui/ai-elements/response";
import type { ToolPart } from "kui/ai-elements/tool";
import { Fragment, type ReactNode } from "react";
import { type AcpInputLabels, AcpInputView } from "./input-view";
import { AcpMessageView } from "./message-view";
import { AcpNoteView } from "./note-view";
import { AcpPermissionView } from "./permission-view";
import { AcpPlanView, type AcpProcessLabels, AcpProcessView, AcpStepView } from "./process-view";
import { type AcpResourceLabels, type AcpResourceResolver, AcpResourceView } from "./resource-view";
import type { AcpCitationLabels, AcpReasoningLabels, AcpTranscriptSlots } from "./slots";
import { AcpToolCallView } from "./tool-call-view";
import { type AcpToolRunLabels, AcpToolRunView } from "./tool-run-view";

export interface AcpTranscriptLabels {
  citations?: Partial<AcpCitationLabels>;
  process?: Partial<AcpProcessLabels>;
  input?: Partial<AcpInputLabels>;
  resources?: Partial<AcpResourceLabels>;
  jobs?: Record<string, string>;
  permissionAnswered?: string;
  permissionCancelled?: string;
  permissionConfirmationUnknown?: string;
  permissionRetry?: string;
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
  onAnswerInput?: (block: AcpInputBlock, response: AcpInputResponse) => void;
  resolveResource?: AcpResourceResolver;
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
  onAnswerInput,
  resolveResource,
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
            citationLabels={labels?.citations}
            resolveResource={resolveResource}
            resourceLabels={labels?.resources}
          />
        );
      case "tool_call":
        return (
          <ToolCallView
            key={block.id}
            block={block}
            statusLabels={labels?.toolStatuses}
            outcomeLabels={labels?.process}
            resolveResource={resolveResource}
            resourceLabels={labels?.resources}
          />
        );
      case "permission":
        return (
          <PermissionView
            key={block.id}
            block={block}
            onAnswer={(optionId) => onAnswerPermission(block, optionId)}
            answeredLabel={labels?.permissionAnswered}
            cancelledLabel={labels?.permissionCancelled}
            confirmationUnknownLabel={labels?.permissionConfirmationUnknown}
            retryLabel={labels?.permissionRetry}
            timeoutLabel={labels?.permissionTimeout}
            timingOutLabel={labels?.permissionTimingOut}
          />
        );
      case "input_request":
        return (
          <AcpInputView
            block={block}
            key={block.id}
            onAnswer={onAnswerInput ? (response) => onAnswerInput(block, response) : undefined}
            labels={labels?.input}
          />
        );
      case "plan":
        return <AcpPlanView block={block} key={block.id} labels={labels?.process} />;
      case "resource":
        return (
          <AcpResourceView
            resource={block.resource}
            key={block.id}
            resolveResource={resolveResource}
            labels={labels?.resources}
          />
        );
      case "job":
        return (
          <section
            className="my-2 rounded border p-3 text-sm"
            data-testid="acp-job"
            data-job-id={block.id}
            data-status={block.job.status}
            key={block.id}
          >
            <p className="font-medium">{block.job.title}</p>
            <p role="status" className="text-muted-foreground text-xs">
              {labels?.jobs?.[block.job.status] ?? block.job.status}
            </p>
            {block.job.message ? <p className="mt-1 break-words">{block.job.message}</p> : null}
          </section>
        );
      case "step":
        return (
          <AcpStepView
            block={block}
            index={
              blocks
                .filter((item) => item.kind === "step" && item.turnId === block.turnId)
                .findIndex((item) => item.id === block.id) + 1
            }
            labels={labels?.process}
            key={block.id}
          />
        );
      case "turn":
        return null;
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

  const renderFlat = (items: readonly AcpBlock[]) =>
    groupConsecutiveToolCalls(items).map((group, index) =>
      group.kind === "run" ? (
        <ToolRunView
          blocks={group.blocks}
          key={`run:${group.blocks.map((block) => block.id).join(":")}:${index}`}
          labels={labels?.tools}
          statusLabels={labels?.toolStatuses}
          outcomeLabels={labels?.process}
          resolveResource={resolveResource}
          resourceLabels={labels?.resources}
        />
      ) : (
        <Fragment key={`${group.block.kind}:${group.block.id}:${index}`}>
          {renderSingle(group.block)}
        </Fragment>
      ),
    );
  const renderedTurns = new Set<string>();
  const output: ReactNode[] = [];
  let pending: AcpBlock[] = [];
  const flush = () => {
    if (pending.length)
      output.push(<Fragment key={`flat:${output.length}`}>{renderFlat(pending)}</Fragment>);
    pending = [];
  };
  for (const block of blocks) {
    if (block.kind !== "turn") {
      if (!("turnId" in block) || !block.turnId || !renderedTurns.has(block.turnId))
        pending.push(block);
      continue;
    }
    flush();
    renderedTurns.add(block.id);
    const owned = blocks.filter((item) => "turnId" in item && item.turnId === block.id);
    const plans = owned.filter((item) => item.kind === "plan");
    const resources = owned.filter((item) => item.kind === "resource" || item.kind === "job");
    const lastToolIndex = owned.findLastIndex(
      (item) =>
        item.kind === "tool_call" || item.kind === "input_request" || item.kind === "permission",
    );
    const answers = owned.filter(
      (item, index) =>
        index > lastToolIndex &&
        item.kind === "message" &&
        item.role === "agent" &&
        item.variant === "message" &&
        Boolean(
          item.text ||
            item.attachments?.length ||
            item.content?.some((content) => content.type !== "text" || content.text.length > 0),
        ),
    );
    const answerSet = new Set(answers);
    const process = owned.filter(
      (item) =>
        !answerSet.has(item) &&
        item.kind !== "plan" &&
        item.kind !== "resource" &&
        item.kind !== "job",
    );
    const tools = owned.filter((item) => item.kind === "tool_call").length;
    const summary =
      tools > 0 ? (labels?.tools?.usedTools(tools) ?? `${tools} tool calls`) : undefined;
    output.push(
      <Fragment key={`turn:${block.id}`}>
        {renderFlat(plans)}
        <AcpProcessView turn={block} blocks={owned} summary={summary} labels={labels?.process}>
          {renderFlat(process)}
        </AcpProcessView>
        {renderFlat(answers)}
        {renderFlat(resources)}
      </Fragment>,
    );
  }
  flush();
  return <div className={className}>{output}</div>;
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
