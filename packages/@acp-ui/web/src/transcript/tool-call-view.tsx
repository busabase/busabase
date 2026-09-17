"use client";

import { Tool, ToolHeader } from "kui/ai-elements/tool";
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
 */
export function AcpToolCallView({ block, statusLabels }: AcpToolCallViewProps) {
  const state = kuiToolState(block.status);
  const statusLabel = statusLabels?.[state];
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
    </Tool>
  );
}
