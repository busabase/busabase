"use client";

import { attachmentToContentBlock } from "@acp-ui/core/prompt";
import type { AcpUiEvent } from "@acp-ui/core/reduce";
import type { AcpSessionPort } from "@acp-ui/core/session";
import { useAcpSession } from "@acp-ui/core/session";
import { consumeEventIterator } from "@orpc/client";
import { type InfiniteData, type QueryKey, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentSessionEventVO,
  AgentSessionsPageVO,
  AgentSessionVO,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import { useMemo } from "react";
import { shouldRenderAgentMessage } from "../utils/agent-visible-message";

/**
 * Translate one persisted busabase event into zero or more shared-model
 * events. Zero for events the transcript does not render, which is
 * deliberately the same set the previous `buildAgentTimeline` ignored. More
 * than one only for a `user_message` that carries attachments — see below.
 */
export function translateAgentSessionEvent(event: AgentSessionEventVO): AcpUiEvent[] {
  if (event.kind === "permissionRequest" && event.permissionRequest) {
    return [
      {
        type: "permission_request",
        requestId: event.permissionRequest.requestId,
        title: event.permissionRequest.title ?? "runs a tool call",
        options: event.permissionRequest.options,
        // No `timeoutAt` on purpose: busabase waits indefinitely and never
        // auto-approves. That is a security property, so the card must not
        // imply the request will lapse on its own.
      },
    ];
  }

  if (
    event.kind === "permissionResolved" &&
    event.permissionRequestId &&
    event.permissionOptionId
  ) {
    return [
      {
        type: "permission_resolved",
        requestId: event.permissionRequestId,
        optionId: event.permissionOptionId,
      },
    ];
  }

  if (event.kind !== "acpUpdate" || !event.acpUpdate || typeof event.acpUpdate !== "object") {
    // `status` drives the header, not the transcript. `error` is currently not
    // rendered either — that matches the previous behaviour exactly, and is
    // noted as a follow-up rather than changed here.
    return [];
  }

  const update = event.acpUpdate as Record<string, unknown>;
  const tag = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";

  // busabase emits its own session-level notes (e.g. an attachment busabase
  // could not send to this agent). Not an ACP tag. Filtered rather than
  // translated unconditionally: a legacy persisted unsupported-HTTP-MCP note
  // and raw ACP transport-close noise are both session-level text that
  // reached this path historically, but neither is something the user should
  // see — see `shouldRenderAgentMessage`.
  if (tag === "note" && typeof update.text === "string") {
    return shouldRenderAgentMessage(update.text) ? [{ type: "note", text: update.text }] : [];
  }

  // Also busabase's own, and NOT the ACP wire shape: the user's prompt is
  // echoed back as `{ sessionUpdate: "user_message", text, attachments? }`,
  // with the text at the top level rather than inside `content`, and any
  // attachments riding alongside rather than as their own content blocks.
  // Left untranslated it would be dropped by the ACP-native reducer and the
  // user's own words (and pictures) would vanish from a replayed session.
  //
  // One `user_message_chunk` for the text, one more per attachment. All chunks
  // from this event share a stable id so they become one message, while the
  // next persisted user event starts a new message even when a cancelled turn
  // produced no intervening agent chunk.
  if (tag === "user_message" && typeof update.text === "string") {
    const attachments = Array.isArray(update.attachments)
      ? (update.attachments as PromptAttachmentInput[])
      : [];
    const messageId = `busabase-user:${event.sessionId}:${event.seq}`;
    return [
      {
        type: "session_update",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: update.text },
          messageId,
        } as never,
      },
      // Built through the same helper the send path uses, rather than
      // hand-rolling `{ type: attachment.kind }`: that shape is only a valid
      // ACP content block for `image`/`audio`, so a `file` attachment would
      // produce `{ type: "file" }`, be rejected by the reducer, and silently
      // vanish from a replayed transcript — the very failure the comment
      // above warns about, one kind later.
      ...attachments.map(
        (attachment): AcpUiEvent => ({
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: attachmentToContentBlock(attachment),
            messageId,
          },
        }),
      ),
    ];
  }

  return [{ type: "session_update", update: update as never }];
}

/**
 * busabase's ACP transport, expressed as an `AcpSessionPort`.
 *
 * The subscription keeps the reconnect behaviour it always had: it resumes from
 * the last `seq` seen rather than from zero, so a connection dropped mid-reply
 * catches up on what it missed instead of losing those tokens or replaying the
 * whole transcript. That is also why no `history` is supplied — subscribing
 * from `seq -1` already replays everything, so there is no separate history
 * fetch to race with.
 *
 * Sessions here are created explicitly by the user, so `start` adopts the one
 * already selected rather than opening a new one.
 */
export function useAgentSession(
  orpc: BusabaseQueryUtils,
  sessionId: string | null,
  pagedSessionQueryKey?: QueryKey,
) {
  const queryClient = useQueryClient();
  const port = useMemo<AcpSessionPort>(
    () => ({
      start: async () => sessionId ?? "",

      subscribe: (id, onEvent, signal) => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let lastSeq = -1;

        const connect = () => {
          if (cancelled) return;
          unsubscribe = consumeEventIterator(
            orpc.agents.sessions.subscribe.call({ sessionId: id, afterSeq: lastSeq }, { signal }),
            {
              onEvent: (event: AgentSessionEventVO) => {
                if (cancelled) return;
                lastSeq = Math.max(lastSeq, event.seq);
                if (event.kind === "status" && event.status) {
                  const applyStatus = (session: AgentSessionVO) =>
                    session.id === id
                      ? {
                          ...session,
                          status: event.status as AgentSessionVO["status"],
                          lastActivityAt: event.at,
                          ...(event.status === "failed" && event.message
                            ? { error: event.message }
                            : {}),
                        }
                      : session;
                  queryClient.setQueryData(
                    orpc.agents.sessions.list.queryKey(),
                    (previous: AgentSessionVO[] | undefined) => previous?.map(applyStatus),
                  );
                  if (pagedSessionQueryKey)
                    queryClient.setQueryData<InfiniteData<AgentSessionsPageVO>>(
                      pagedSessionQueryKey,
                      (previous) =>
                        previous
                          ? {
                              ...previous,
                              pages: previous.pages.map((page) => ({
                                ...page,
                                items: page.items.map(applyStatus),
                              })),
                            }
                          : previous,
                    );
                }
                const update = event.acpUpdate as { sessionUpdate?: unknown } | undefined;
                if (
                  event.kind === "acpUpdate" &&
                  update?.sessionUpdate === "config_option_update"
                ) {
                  void queryClient.invalidateQueries({
                    queryKey: orpc.agents.sessions.list.queryKey(),
                  });
                  if (pagedSessionQueryKey) {
                    void queryClient.invalidateQueries({ queryKey: pagedSessionQueryKey });
                  }
                }
                for (const translated of translateAgentSessionEvent(event)) onEvent(translated);
              },
              onError: () => {
                // The server ends the stream when a session ends, which arrives
                // here as an error. Retrying is harmless (the session is gone,
                // so the next attempt simply fails too) and it is what keeps a
                // transient network blip from silently freezing the transcript.
                if (!cancelled && !signal.aborted) {
                  retryTimer = setTimeout(connect, 3000);
                }
              },
            },
          );
        };

        connect();

        return () => {
          cancelled = true;
          if (retryTimer) clearTimeout(retryTimer);
          unsubscribe?.();
        };
      },

      prompt: async (id, text, attachments) => {
        await orpc.agents.sessions.prompt.call({
          sessionId: id,
          text,
          ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
        });
      },

      answerPermission: async (id, block, optionId) => {
        await orpc.agents.sessions.respondToPermission.call({
          sessionId: id,
          requestId: block.id,
          optionId,
        });
        return true;
      },

      // The backend has had a complete, working session/cancel path since
      // before this package existed (agent-session-manager.ts's
      // `session.cancel` + the router's `cancel` procedure) — it was simply
      // never called from the UI. This is the wiring, not new capability.
      cancel: async (id) => {
        await orpc.agents.sessions.cancel.call({ sessionId: id });
      },

      // The server echoes the prompt back as a `user_message` event, so the
      // core must not append it too — that would show it twice.
      serverEchoesPrompt: true,

      // `end` is deliberately NOT implemented, even though the backend has a
      // working close path and the slot is right here. `useAcpSession` calls
      // `port.end?.()` from an effect cleanup keyed on the session id, so
      // implementing it would end the previous conversation every time the
      // user clicks another session in the rail, closes the side-panel tab,
      // navigates away from /agents, or React StrictMode double-mounts in dev.
      // That slot was written for acprouter's ephemeral sessions; busabase's
      // are durable and user-created. Ending one is an explicit act, wired to
      // the explicit "End session" button in `agent-detail-view.tsx`.
    }),
    [orpc, pagedSessionQueryKey, queryClient, sessionId],
  );

  return useAcpSession(port, sessionId);
}
