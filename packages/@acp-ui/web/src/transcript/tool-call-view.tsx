"use client";

import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "kui/ai-elements/tool";
import { Badge } from "kui/badge";
import { CollapsibleTrigger } from "kui/collapsible";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { AcpToolContentView } from "./content-view";
import type { AcpToolCallViewProps } from "./slots";
import { parentToolCallId } from "./tool-parent";
import { type KuiToolState, kuiToolState } from "./tool-status";

const statusIcons: Record<KuiToolState, ReactNode> = {
  "input-streaming": <CircleIcon className="size-4" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

/**
 * One tool call, collapsed into a single row that updates in place.
 *
 * The core keys tool calls by `toolCallId`, so the `tool_call` plus its stream
 * of `tool_call_update`s arrive here as one block whose status changes — rather
 * than as the up-to-six identical rows the flat-text implementation produced.
 *
 * The header stays a single compact row regardless of payload; `rawInput`/
 * `rawOutput` only add an expandable `ToolContent` when at least one is
 * present, so a call with no rich detail data (most ACP agents, today) renders
 * exactly as it did before this existed.
 */
export function AcpToolCallView({
  block,
  statusLabels,
  outcomeLabels,
  resolveResource,
  resourceLabels,
}: AcpToolCallViewProps) {
  const state = kuiToolState(block.status);
  const statusLabel =
    block.outcome === "cancelled"
      ? (outcomeLabels?.cancelled ?? "Stopped")
      : block.outcome === "interrupted"
        ? (outcomeLabels?.interrupted ?? "Interrupted")
        : statusLabels?.[state];
  const hasContent = Boolean(block.content?.length);
  const hasLocations = Boolean(block.locations?.length);
  // Legacy saved blocks may contain null raw fields. Do not show an empty
  // disclosure for those values; the v1 reducer treats null updates as absent.
  const hasInput = block.rawInput !== undefined && block.rawInput !== null;
  const hasOutput = block.rawOutput !== undefined && block.rawOutput !== null;
  const isError = block.status === "failed";
  return (
    <Tool data-testid="acp-tool-call" data-parent-tool-call-id={parentToolCallId(block)}>
      {statusLabel ? (
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-left font-medium text-sm [overflow-wrap:anywhere]">
              {block.title ?? block.toolKind ?? "tool"}
            </span>
            <Badge className="shrink-0 gap-1.5 rounded-full text-xs" variant="secondary">
              {statusIcons[state]}
              {statusLabel}
            </Badge>
          </div>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
      ) : (
        <ToolHeader
          // ACP's dynamic tool name is used only when no agent-authored title exists.
          type="dynamic-tool"
          toolName={block.toolKind ?? "tool"}
          title={block.title}
          state={state}
          className="[&>div]:min-w-0 [&>div]:flex-1 [&_span]:[overflow-wrap:anywhere]"
        />
      )}
      {(hasInput || hasOutput || hasContent || hasLocations) && (
        <ToolContent>
          {hasLocations ? (
            <ul className="space-y-1 break-all font-mono text-xs" data-testid="acp-tool-locations">
              {block.locations?.map((location) => (
                <li key={`${location.path}:${location.line ?? ""}`}>
                  {location.path}
                  {location.line != null ? `:${location.line}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {hasContent ? (
            <div data-testid="acp-tool-output">
              {block.content?.map((content, index) => (
                <AcpToolContentView
                  key={`${block.id}:${index}`}
                  content={content}
                  resolveResource={resolveResource}
                  resourceLabels={resourceLabels}
                />
              ))}
            </div>
          ) : null}
          {hasInput && <ToolInput data-testid="acp-tool-input" input={block.rawInput} />}
          {hasOutput && !hasContent && (
            <ToolOutput
              data-testid="acp-tool-output"
              errorText={isError ? describeError(block.rawOutput) : undefined}
              output={isError ? undefined : block.rawOutput}
            />
          )}
          {hasOutput && hasContent ? (
            <details className="text-xs" data-testid="acp-tool-raw-output">
              <summary className="cursor-pointer">Raw output</summary>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">
                {describeError(block.rawOutput)}
              </pre>
            </details>
          ) : null}
        </ToolContent>
      )}
    </Tool>
  );
}

/**
 * ACP's `rawOutput` on a failed call is `unknown` — often a string, sometimes
 * a structured error object. `ToolOutput.errorText` renders as plain text, so
 * anything non-string is stringified rather than dropped.
 */
function describeError(rawOutput: unknown): string {
  if (typeof rawOutput === "string") return rawOutput;
  try {
    return JSON.stringify(rawOutput, null, 2);
  } catch {
    return String(rawOutput);
  }
}
