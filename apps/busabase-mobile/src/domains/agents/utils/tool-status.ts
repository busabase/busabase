import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import type { CoreMessages } from "~/i18n/messages";

export type ToolStatusLabelKey =
  | "toolStatusPending"
  | "toolStatusRunning"
  | "toolStatusCompleted"
  | "toolStatusError";

/**
 * ACP's four tool statuses onto the four i18n keys shared with core's own
 * `agents.toolStatus*` strings.
 *
 * A total `Record`, not a `switch` with a default: if ACP ever adds a status
 * (v2 adds `cancelled`) this stops compiling instead of silently mislabeling
 * it — same reasoning as `@acp-ui/web`'s `kuiToolState`.
 */
const LABEL_KEY_BY_STATUS: Record<AcpToolCallBlock["status"], ToolStatusLabelKey> = {
  pending: "toolStatusPending",
  in_progress: "toolStatusRunning",
  completed: "toolStatusCompleted",
  failed: "toolStatusError",
};

export const toolStatusLabel = (
  status: AcpToolCallBlock["status"],
  t: Pick<CoreMessages["agents"], ToolStatusLabelKey>,
): string => t[LABEL_KEY_BY_STATUS[status]];
