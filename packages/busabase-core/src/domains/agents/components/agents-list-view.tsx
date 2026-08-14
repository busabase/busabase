"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import { Bot, Plus } from "lucide-react";
import { useMemo } from "react";
import { TransportBadge } from "./transport-badge";

interface AgentGroup {
  slug: string;
  agentName: string;
  transport: AgentSessionVO["transport"];
  sessionCount: number;
  latest: AgentSessionVO;
}

interface AgentsListViewProps {
  orpc: BusabaseQueryUtils;
  onSelectAgent: (slug: string) => void;
  onAddAgent: () => void;
}

/**
 * Agents you've connected. Browsing *what's connectable* lives on the Add
 * page (`AgentsAddView`) — this page only ever shows agents with at least one
 * session, grouped by catalog slug so "3 conversations with Claude Code"
 * reads as one card, not three.
 */
export function AgentsListView({ orpc, onSelectAgent, onAddAgent }: AgentsListViewProps) {
  const sessions = useQuery({
    ...orpc.agents.sessions.list.queryOptions(),
    refetchInterval: 4000,
  });

  const groups = useMemo<AgentGroup[]>(() => {
    const bySlug = new Map<string, AgentSessionVO[]>();
    for (const session of sessions.data ?? []) {
      const list = bySlug.get(session.slug) ?? [];
      list.push(session);
      bySlug.set(session.slug, list);
    }
    return [...bySlug.entries()]
      .map(([slug, list]) => ({
        slug,
        agentName: list[0].agentName,
        transport: list[0].transport,
        sessionCount: list.length,
        latest: list.reduce((a, b) => (a.lastActivityAt > b.lastActivityAt ? a : b)),
      }))
      .sort((a, b) => b.latest.lastActivityAt.localeCompare(a.latest.lastActivityAt));
  }, [sessions.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="font-medium text-lg">Agents</h1>
          <p className="text-muted-foreground text-sm">
            Connect an external AI agent. Busabase has no AI engine of its own.
          </p>
        </div>
        <Button size="sm" onClick={onAddAgent}>
          <Plus className="size-4" />
          Add agent
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <div>
              <h2 className="font-medium">No agents connected yet</h2>
              <p className="mt-1 text-muted-foreground text-sm">
                Connect Claude Code, Codex, or a Buda AI Agent to get started.
              </p>
            </div>
            <Button onClick={onAddAgent}>
              <Plus className="size-4" />
              Add agent
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <button
                type="button"
                key={group.slug}
                onClick={() => onSelectAgent(group.slug)}
                className="flex flex-col gap-2 rounded-lg border p-4 text-left hover:bg-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <Bot className="size-4" />
                    {group.agentName}
                  </span>
                  <TransportBadge transport={group.transport} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {group.sessionCount} {group.sessionCount === 1 ? "session" : "sessions"} ·{" "}
                  {group.latest.status}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
