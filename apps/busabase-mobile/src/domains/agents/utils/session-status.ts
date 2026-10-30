import type { AcpBlock } from "@acp-ui/core/reduce";
import type { AgentSessionStatus } from "busabase-contract/domains/agents/types";
import type { CoreMessages } from "~/i18n/messages";

type StatusMessages = Pick<
  CoreMessages["agents"],
  | "statusConnecting"
  | "statusIdle"
  | "statusBusy"
  | "statusWaitingPermission"
  | "statusEnded"
  | "statusFailed"
>;

/** Shared by every screen that lists a persisted `AgentSessionVO.status`. */
export function agentSessionStatusLabel(status: AgentSessionStatus, t: StatusMessages): string {
  return {
    connecting: t.statusConnecting,
    idle: t.statusIdle,
    busy: t.statusBusy,
    waiting_permission: t.statusWaitingPermission,
    ended: t.statusEnded,
    failed: t.statusFailed,
  }[status];
}

/**
 * The chat screen has no persisted `status` to read — `useAgentSession`
 * exposes `sending`/`ended`/`error`/`blocks` instead, which is the live ACP
 * state, not busabase's own enum. This derives the same six-value status
 * from that live state so the chat header can share `agentSessionStatusLabel`
 * with the two list screens rather than inventing its own wording.
 */
export function deriveAgentSessionStatus(chat: {
  sessionId: string | null;
  blocks: readonly AcpBlock[];
  sending: boolean;
  ended: boolean;
  error: string | null;
}): AgentSessionStatus {
  if (chat.error) return "failed";
  if (chat.ended) return "ended";
  if (!chat.sessionId) return "connecting";
  if (
    chat.blocks.some(
      (block) =>
        (block.kind === "permission" || block.kind === "input_request") &&
        (block.resolution === "pending" || block.resolution === "answering"),
    )
  )
    return "waiting_permission";
  const turn = chat.blocks.findLast((block) => block.kind === "turn");
  return chat.sending || (turn?.kind === "turn" && turn.status === "running") ? "busy" : "idle";
}
