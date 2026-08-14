"use client";

import { consumeEventIterator } from "@orpc/client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionEventVO } from "busabase-contract/domains/agents/types";
import { useEffect, useState } from "react";

/**
 * Follow one agent session's event stream.
 *
 * Reconnects resume from the last `seq` seen rather than from zero, so a dropped
 * connection mid-reply catches up on what it missed instead of either losing
 * those tokens or replaying the whole transcript. This mirrors how
 * `use-live-sync.ts` consumes the dashboard's own Event Iterator.
 */
export function useAgentSessionStream(
  orpc: BusabaseQueryUtils,
  sessionId: string | null,
): AgentSessionEventVO[] {
  const [events, setEvents] = useState<AgentSessionEventVO[]>([]);

  useEffect(() => {
    setEvents([]);
    if (!sessionId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSeq = -1;
    const controller = new AbortController();

    const connect = () => {
      if (cancelled) return;
      unsubscribe = consumeEventIterator(
        orpc.agents.sessions.subscribe.call(
          { sessionId, afterSeq: lastSeq },
          { signal: controller.signal },
        ),
        {
          onEvent: (event: AgentSessionEventVO) => {
            if (cancelled) return;
            lastSeq = Math.max(lastSeq, event.seq);
            setEvents((previous) => [...previous, event]);
          },
          onError: () => {
            // The server ends the stream when a session ends, which arrives here
            // as an error. Retrying is harmless (the session is gone, so the next
            // attempt simply fails too) and it is what keeps a transient network
            // blip from silently freezing the transcript.
            if (!cancelled && !controller.signal.aborted) {
              retryTimer = setTimeout(connect, 3000);
            }
          },
        },
      );
    };

    connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [orpc, sessionId]);

  return events;
}
