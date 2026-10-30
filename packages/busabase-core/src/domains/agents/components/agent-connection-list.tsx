"use client";

import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import type { ReactNode } from "react";
import { useCoreLocale } from "../../../i18n";
import { agentAvailabilityCopy } from "../../../i18n/agent-availability-copy";
import { getAgentConnectionState } from "../utils/agent-connection-state";
import { AgentConnectionIndicator, AgentConnectionStatus } from "./agent-connection-status";

interface AgentConnectionListProps {
  connections: readonly AgentConnectionVO[];
  onSelect: (connection: AgentConnectionVO) => void;
  renderActions?: (connection: AgentConnectionVO) => ReactNode;
}

/** A shared connection inventory; each host owns fetching and navigation. */
export function AgentConnectionList({
  connections,
  onSelect,
  renderActions,
}: AgentConnectionListProps) {
  const copy = agentAvailabilityCopy(useCoreLocale());
  return (
    <div
      className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3"
      data-testid="agent-connection-list"
      role="list"
    >
      {connections.map((connection) => {
        const state = getAgentConnectionState(connection);
        const available = state === "saved" || state === "local";
        const connecting = available && connection.latest?.status === "connecting";
        const activity = available
          ? connection.latest?.status === "busy"
            ? copy.replying
            : connection.latest?.status === "waiting_permission"
              ? copy.waiting
              : connecting
                ? copy.sessionConnecting
                : connection.latest?.status === "failed"
                  ? copy.failed
                  : null
          : null;
        const history = state === "disconnected" && connection.sessionCount > 0;
        const actions = renderActions?.(connection);
        return (
          <div
            className={`relative min-w-0 rounded-lg border bg-card transition-colors hover:bg-accent/60 ${state === "disconnected" ? "border-dashed" : ""}`}
            data-agent-slug={connection.slug}
            data-connection-state={state}
            data-testid="agent-connection-card"
            key={connection.slug}
            role="listitem"
          >
            <button
              className={`flex h-full min-h-24 w-full min-w-0 items-start gap-2.5 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${actions ? "pr-12" : ""}`}
              onClick={() => onSelect(connection)}
              type="button"
            >
              <span className="mt-1.5 inline-flex shrink-0">
                <AgentConnectionIndicator state={state} connecting={connecting} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="break-words font-medium text-foreground text-sm">
                  {connection.agentName}
                </span>
                <span
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-foreground/70 text-xs"
                  title={state === "saved" ? copy.savedHint : undefined}
                >
                  <AgentConnectionStatus state={state} showIndicator={false} />
                  {activity || history ? <span aria-hidden="true">·</span> : null}
                  {activity ? <span>{activity}</span> : null}
                  {history ? <span>{copy.history}</span> : null}
                </span>
              </span>
            </button>
            {actions ? <div className="absolute top-1 right-1">{actions}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
