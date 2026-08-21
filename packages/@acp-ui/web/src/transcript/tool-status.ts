import type { AcpToolCallBlock } from "@acp-ui/core/reduce";

/**
 * The subset of `kui`'s tool states this package uses.
 *
 * Declared structurally rather than imported from `ai` on purpose: `@acp-ui/*`
 * exists precisely because ACP is not modelled on the AI SDK, so adding `ai` as
 * a dependency here would blur the boundary the packages are drawing. The union
 * below is a strict subset of `ToolUIPart["state"]`, so assignability is still
 * checked for real at the `<ToolHeader>` call site in `tool-call-view.tsx` — if
 * `kui` ever renames a state, that file stops compiling.
 */
export type KuiToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

/**
 * ACP's four tool statuses map one-to-one onto four `kui` states whose labels
 * already say the right thing ("Pending" / "Running" / "Completed" / "Error").
 *
 * Typed as a total `Record`, so if ACP ever adds a status (v2 adds `cancelled`)
 * this stops compiling instead of silently falling through to a default.
 */
const KUI_STATE_BY_ACP_STATUS: Record<AcpToolCallBlock["status"], KuiToolState> = {
  pending: "input-streaming",
  in_progress: "input-available",
  completed: "output-available",
  failed: "output-error",
};

export function kuiToolState(status: AcpToolCallBlock["status"]): KuiToolState {
  return KUI_STATE_BY_ACP_STATUS[status];
}
