"use client";

import { Tool, ToolHeader } from "kui/ai-elements/tool";
import type { AcpToolCallViewProps } from "./slots";
import { kuiToolState } from "./tool-status";

/**
 * One tool call, collapsed into a single row that updates in place.
 *
 * The core keys tool calls by `toolCallId`, so the `tool_call` plus its stream
 * of `tool_call_update`s arrive here as one block whose status changes — rather
 * than as the up-to-six identical rows the flat-text implementation produced.
 */
export function AcpToolCallView({ block }: AcpToolCallViewProps) {
  return (
    <Tool data-testid="acp-tool-call">
      <ToolHeader
        // `dynamic-tool` is kui's shape for a tool whose name is not known at
        // compile time, which is exactly an ACP tool call. `title` is what the
        // user reads; `toolName` only backs the fallback label.
        type="dynamic-tool"
        toolName={block.toolKind ?? "tool"}
        title={block.title}
        state={kuiToolState(block.status)}
      />
    </Tool>
  );
}
