import type {
  AgentSessionStatus,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import { isReusableSession } from "./node-agent-sessions";

/**
 * What sending into an ended/failed session actually requires: a new session
 * for the same agent, then the message the user already typed — not a second
 * click, and not a message that silently vanishes.
 *
 * `AgentDetailView` used to let the composer accept input on any status
 * (PUL-214) but still called `chat.sendPrompt`, which targets whichever
 * session `useAgentSession` was started with. Once that session is `ended`/
 * `failed`, `promptAgentSession` throws server-side — and because
 * `serverEchoesPrompt` is `true`, the client never appended its own echo, so
 * the user's message just disappears. This module is the fix's decision
 * logic: reuse `isReusableSession` (the one place that already knows which
 * statuses can take another message) rather than inventing a second terminal
 * check that could drift from it.
 */

export interface AgentSessionContinuationDeps {
  /** Creates a new session for the given catalog slug. */
  createSession: (slug: string) => Promise<{ id: string }>;
  /** Sends text (+ optional attachments) to an existing session by id. */
  sendPrompt: (
    sessionId: string,
    text: string,
    attachments?: readonly PromptAttachmentInput[],
  ) => Promise<AgentPromptAttempt>;
  /**
   * Called with the new session's id as soon as it exists — before the prompt
   * is sent — so the caller can select it and let the server echo of the
   * user's message land somewhere visible instead of the transcript that is
   * about to go silent.
   */
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
}

export type AgentPromptAttempt =
  | { accepted: true }
  | { accepted: false; promptRecorded: boolean; message: string };

export interface AgentSessionContinuationResult {
  /** Whether the existing session was reused, or a new one had to be created. */
  outcome: "reused" | "continued";
  /** The session the message was actually sent to. */
  sessionId: string;
}

/**
 * Decide whether `sessionId`/`status` can take another message, and either
 * send directly or transparently continue into a fresh session for `slug`.
 *
 * Continuation errors are distinguished from send errors only by timing —
 * both are just whatever `createSession`/`sendPrompt` throw — because to the
 * user "couldn't continue this conversation" IS "the send failed"; there is
 * no separate recovery step to offer.
 */
export async function sendOrContinueAgentPrompt(
  deps: AgentSessionContinuationDeps,
  current: { sessionId: string; status: AgentSessionStatus } | null,
  slug: string,
  text: string,
  attachments?: readonly PromptAttachmentInput[],
): Promise<AgentSessionContinuationResult> {
  if (current && isReusableSession(current.status)) {
    const attempt = await deps.sendPrompt(current.sessionId, text, attachments);
    if (attempt.accepted) return { outcome: "reused", sessionId: current.sessionId };
    if (attempt.promptRecorded) throw new Error(attempt.message);
  }

  const created = await deps.createSession(slug);
  await deps.onSessionCreated?.(created.id);
  const attempt = await deps.sendPrompt(created.id, text, attachments);
  if (!attempt.accepted) throw new Error(attempt.message);
  return { outcome: "continued", sessionId: created.id };
}
