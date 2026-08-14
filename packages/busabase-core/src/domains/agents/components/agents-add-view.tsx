"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentCatalogEntryVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import { ArrowLeft, Bot } from "lucide-react";
import { TransportBadge } from "./transport-badge";

interface AgentsAddViewProps {
  orpc: BusabaseQueryUtils;
  onBack: () => void;
  onConnected: (slug: string) => void;
}

/** Browse the catalog and connect one. This is the only place the catalog is shown. */
export function AgentsAddView({ orpc, onBack, onConnected }: AgentsAddViewProps) {
  const queryClient = useQueryClient();
  const catalog = useQuery(orpc.agents.catalog.queryOptions());

  const createSession = useMutation({
    ...orpc.agents.sessions.create.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      void queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() });
      onConnected(session.slug);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <h1 className="font-medium text-lg">Add agent</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(catalog.data ?? []).map((entry: AgentCatalogEntryVO) => (
            <div key={entry.slug} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Bot className="size-4" />
                  {entry.name}
                </span>
                <TransportBadge transport={entry.transport} />
              </div>
              <p className="text-muted-foreground text-xs">{entry.description}</p>
              {entry.available ? (
                <Button
                  size="sm"
                  disabled={createSession.isPending}
                  onClick={() => createSession.mutate({ slug: entry.slug })}
                >
                  {createSession.isPending && createSession.variables?.slug === entry.slug
                    ? "Connecting…"
                    : "Connect"}
                </Button>
              ) : (
                <p className="text-destructive text-xs">{entry.unavailableReason}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
