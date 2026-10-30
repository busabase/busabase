"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionScope } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import { Tabs, TabsList, TabsTrigger } from "kui/tabs";
import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useAgentModelScope } from "../agent-model-scope-context";
import { useAgentConnectionActions } from "./agent-connection-actions";
import { AgentConnectionList } from "./agent-connection-list";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";

const LOCAL_AGENT_SLUGS = ["claude-acp", "codex-acp"] as const;

interface AgentsListViewProps {
  orpc: BusabaseQueryUtils;
  onSelectAgent: (slug: string) => void;
  onAddAgent: () => void;
}

/**
 * Connected agents and retained history. Browsing *what's connectable* lives
 * on the Add page (`AgentsAddView`); conversations are grouped by stable agent
 * slug so "3 conversations with Claude Code" reads as one card, not three.
 */
export function AgentsListView(props: AgentsListViewProps) {
  const scope = useAgentModelScope();
  return <AgentsListViewContent key={JSON.stringify(scope)} {...props} />;
}

function AgentsListViewContent({ orpc, onSelectAgent, onAddAgent }: AgentsListViewProps) {
  const messages = useCoreI18n();
  const [scope, setScope] = useState<AgentConnectionScope>("mine");
  const { renderActions, dialogs } = useAgentConnectionActions(orpc);
  const connections = useQuery({
    ...orpc.agents.connections.list.queryOptions({ input: { scope } }),
    refetchInterval: 4000,
  });

  const connectionItems = connections.data ?? [];
  const addedAgentSlugs = new Set(connectionItems.map((connection) => connection.slug));
  const hasAllLocalAgents = LOCAL_AGENT_SLUGS.every((slug) => addedAgentSlugs.has(slug));
  const emptyTitle =
    scope === "mine" ? messages.agents.mineEmptyTitle : messages.agents.spaceEmptyTitle;
  const emptyBody =
    scope === "mine" ? messages.agents.mineEmptyBody : messages.agents.spaceEmptyBody;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="font-medium text-lg">{messages.agents.title}</h1>
          <p className="max-w-2xl text-muted-foreground text-sm">{messages.agents.description}</p>
        </div>
        <Button
          className="min-h-11 shrink-0 sm:min-h-9"
          disabled={hasAllLocalAgents}
          onClick={onAddAgent}
          size="sm"
        >
          <Plus className="size-4" />
          {messages.agents.addAgent}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          <Tabs
            value={scope}
            onValueChange={(value) => {
              if (value === "mine" || value === "space") setScope(value);
            }}
          >
            <TabsList className="mb-6">
              <TabsTrigger className="min-h-11 sm:min-h-9" value="mine">
                {messages.agents.mineTab}
              </TabsTrigger>
              <TabsTrigger className="min-h-11 sm:min-h-9" value="space">
                {messages.agents.spaceTab}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {connections.isPending ? (
            <AgentLoadingState />
          ) : connections.isError ? (
            <AgentQueryErrorState
              error={connections.error}
              onRetry={() => void connections.refetch()}
              title={messages.agents.loadConnectionsFailedTitle}
            />
          ) : connectionItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Bot className="size-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{emptyTitle}</h2>
                <p className="mt-1 text-muted-foreground text-sm">{emptyBody}</p>
              </div>
              <Button className="min-h-11 sm:min-h-9" onClick={onAddAgent}>
                <Plus className="size-4" />
                {messages.agents.addAgent}
              </Button>
            </div>
          ) : (
            <AgentConnectionList
              connections={connectionItems}
              onSelect={(connection) => onSelectAgent(connection.slug)}
              renderActions={renderActions}
            />
          )}
        </div>
      </div>
      {dialogs}
    </div>
  );
}
