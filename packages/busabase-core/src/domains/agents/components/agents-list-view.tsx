"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentConnectionScope,
  AgentConnectionVO,
} from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "kui/tabs";
import { Bot, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n } from "../../../i18n";
import { ConfirmActionDialog } from "../../dashboard/components/primitives";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
import { TransportBadge } from "./transport-badge";

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
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<AgentConnectionScope>("mine");
  const [disconnecting, setDisconnecting] = useState<AgentConnectionVO | null>(null);
  const connections = useQuery({
    ...orpc.agents.connections.list.queryOptions({ input: { scope } }),
    refetchInterval: 4000,
  });

  const disconnect = useMutation({
    ...orpc.agents.disconnect.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() }),
      ]);
      toast.success("Agent connection deleted.");
      setDisconnecting(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete agent connection.");
    },
  });

  const connectionItems = connections.data ?? [];
  const emptyTitle =
    scope === "mine" ? messages.agents.mineEmptyTitle : messages.agents.spaceEmptyTitle;
  const emptyBody =
    scope === "mine" ? messages.agents.mineEmptyBody : messages.agents.spaceEmptyBody;

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
          {messages.agents.addAgent}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Tabs
          value={scope}
          onValueChange={(value) => {
            if (value === "mine" || value === "space") setScope(value);
          }}
        >
          <TabsList className="mb-6">
            <TabsTrigger value="mine">{messages.agents.mineTab}</TabsTrigger>
            <TabsTrigger value="space">{messages.agents.spaceTab}</TabsTrigger>
          </TabsList>
        </Tabs>

        {connections.isPending ? (
          <AgentLoadingState />
        ) : connections.isError ? (
          <AgentQueryErrorState
            error={connections.error}
            onRetry={() => void connections.refetch()}
            title="Couldn't load connected agents"
          />
        ) : connectionItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <div>
              <h2 className="font-medium">{emptyTitle}</h2>
              <p className="mt-1 text-muted-foreground text-sm">{emptyBody}</p>
            </div>
            <Button onClick={onAddAgent}>
              <Plus className="size-4" />
              {messages.agents.addAgent}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connectionItems.map((group) => (
              <div key={group.slug} className="relative rounded-lg border hover:bg-accent">
                <button
                  type="button"
                  onClick={() => onSelectAgent(group.slug)}
                  className="flex w-full flex-col gap-2 p-4 pr-12 text-left"
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
                    {group.latest?.status ?? "not started"}
                  </p>
                </button>
                {group.ownedByCurrentUser ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={fmt(messages.agents.actionsFor, { name: group.agentName })}
                        className="absolute right-2 bottom-2 size-8"
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setDisconnecting(group)}
                        variant="destructive"
                      >
                        <Trash2 className="mr-2 size-4" />
                        {messages.agents.deleteConnection}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmActionDialog
        body={
          disconnecting
            ? `Delete ${disconnecting.agentName} and its ${disconnecting.sessionCount} ${disconnecting.sessionCount === 1 ? "session" : "sessions"}? This removes the saved connection and conversation history. This cannot be undone.`
            : ""
        }
        confirmLabel={messages.agents.deleteConnection}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => {
          if (disconnecting) disconnect.mutate({ slug: disconnecting.slug });
        }}
        open={disconnecting !== null}
        pending={disconnect.isPending}
        title="Delete agent connection?"
      />
    </div>
  );
}
