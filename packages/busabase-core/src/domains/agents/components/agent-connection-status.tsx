"use client";

import { useCoreLocale } from "../../../i18n";
import { agentAvailabilityCopy } from "../../../i18n/agent-availability-copy";
import type { AgentConnectionState } from "../utils/agent-connection-state";

const stateClasses: Record<AgentConnectionState, string> = {
  saved: "border-merged-strong bg-merged-strong dark:border-merged-soft dark:bg-merged-soft",
  disconnected: "border-rejected-strong dark:border-rejected-soft",
  activating: "border-review-strong dark:border-review-soft",
  disconnecting: "border-review-strong dark:border-review-soft",
  local: "border-muted-foreground bg-muted-foreground",
  checking: "border-muted-foreground/35 border-t-foreground",
  unknown: "border-muted-foreground",
};

export function AgentConnectionIndicator({
  state,
  connecting = false,
}: {
  state: AgentConnectionState;
  connecting?: boolean;
}) {
  const spinning = state === "checking" || connecting;
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-2.5 shrink-0 rounded-full border ${spinning ? "animate-spin border-muted-foreground/35 border-t-foreground motion-reduce:animate-none" : stateClasses[state]}`}
      data-connecting={spinning ? "true" : "false"}
      data-state={state}
      data-testid="agent-connection-indicator"
    />
  );
}

export function AgentConnectionStatus({
  state,
  showIndicator = true,
}: {
  state: AgentConnectionState;
  showIndicator?: boolean;
}) {
  const copy = agentAvailabilityCopy(useCoreLocale());
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
      {showIndicator ? <AgentConnectionIndicator state={state} /> : null}
      <span>{copy[state]}</span>
    </span>
  );
}
