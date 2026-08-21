"use client";

import type { AcpUiEvent } from "@acp-ui/core/reduce";
import type { AcpSessionPort } from "@acp-ui/core/session";
import { useAcpSession } from "@acp-ui/core/session";
import { consumeEventIterator } from "@orpc/client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentSessionEventVO,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import { useMemo } from "react";

/**
 * Translate one persisted busabase event into zero or more shared-model
 * events. Zero for events the transcript does not render, which is
 * deliberately the same set the previous `buildAgentTimeline` ignored. More
 * than one only for a `user_message` that carries attachments — see below.
 */
function translate(event: AgentSessionEventVO): AcpUiEvent[] {
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

  // busabase emits its own session-level note (e.g. "this agent cannot take an
  // HTTP MCP server, so it has no access to workspace data"). Not an ACP tag.
  if (tag === "note" && typeof update.text === "string") {
    return [{ type: "note", text: update.text }];
  }

  // Also busabase's own, and NOT the ACP wire shape: the user's prompt is
  // echoed back as `{ sessionUpdate: "user_message", text, attachments? }`,
  // with the text at the top level rather than inside `content`, and any
  // attachments riding alongside rather than as their own content blocks.
  // Left untranslated it would be dropped by the ACP-native reducer and the
  // user's own words (and pictures) would vanish from a replayed session.
  //
  // One `user_message_chunk` for the text, one more per attachment — no
  // `messageId` on any of them, so the core's reducer merges them into a
  // single block by (role, variant) adjacency, same as the real ACP chunks
  // it already knows how to fold.
  if (tag === "user_message" && typeof update.text === "string") {
    const attachments = Array.isArray(update.attachments)
      ? (update.attachments as PromptAttachmentInput[])
      : [];
    return [
      {
        type: "session_update",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: update.text },
        } as never,
      },
      ...attachments.map(
        (attachment): AcpUiEvent => ({
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: {
              type: attachment.kind,
              data: attachment.data,
              mimeType: attachment.mimeType,
            },
          } as never,
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
export function useAgentSession(orpc: BusabaseQueryUtils, sessionId: string | null) {
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
                for (const translated of translate(event)) onEvent(translated);
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
    }),
    [orpc, sessionId],
  );

  return useAcpSession(port, sessionId);
}
