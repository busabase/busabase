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
import type { AcpToolCallViewProps } from "./slots";
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
export function AcpToolCallView({ block, statusLabels }: AcpToolCallViewProps) {
  const state = kuiToolState(block.status);
  const statusLabel = statusLabels?.[state];
  // ACP uses `null` to explicitly clear a patch field. Keep that distinction
  // in the reducer, but do not turn a cleared value into an empty disclosure.
  const hasInput = block.rawInput !== undefined && block.rawInput !== null;
  const hasOutput = block.rawOutput !== undefined && block.rawOutput !== null;
  const isError = block.status === "failed";
  return (
    <Tool data-testid="acp-tool-call">
      {statusLabel ? (
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3">
          <div className="flex items-center gap-2">
            <WrenchIcon className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">{block.title ?? block.toolKind ?? "tool"}</span>
            <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
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
        />
      )}
      {(hasInput || hasOutput) && (
        <ToolContent>
          {hasInput && <ToolInput data-testid="acp-tool-input" input={block.rawInput} />}
          {hasOutput && (
            <ToolOutput
              data-testid="acp-tool-output"
              errorText={isError ? describeError(block.rawOutput) : undefined}
              output={isError ? undefined : block.rawOutput}
            />
          )}
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
