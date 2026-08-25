"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentCatalogEntryVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { ArrowLeft, Bot, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TransportBadge } from "./transport-badge";

interface AgentsAddViewProps {
  orpc: BusabaseQueryUtils;
  onBack: () => void;
  onConnected: (slug: string) => void;
  spaceId?: string;
}

/** Browse the catalog and connect one. This is the only place the catalog is shown. */
export function AgentsAddView({ orpc, onBack, onConnected, spaceId }: AgentsAddViewProps) {
  const queryClient = useQueryClient();
  const catalog = useQuery(orpc.agents.catalog.queryOptions());
  const [showBudaConnect, setShowBudaConnect] = useState(false);
  const [budaError, setBudaError] = useState<string | null>(null);

  const openBudaConnect = () => {
    setBudaError(null);
    setShowBudaConnect(true);
    const path = `/api/agents/buda/oauth/start${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""}`;
    const popup = window.open(path, "busabase-buda-oauth", "popup,width=560,height=760");
    if (!popup) setBudaError("Allow popups for Busabase, then try again.");
  };

  const createSession = useMutation({
    ...orpc.agents.sessions.create.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.agents.connections.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
      ]);
      onConnected(session.slug);
    },
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "busabase:buda-error") {
        setBudaError(event.data.message || "Buda connection failed.");
      } else if (event.data?.type === "busabase:buda-connected") {
        if (typeof event.data.slug !== "string" || !event.data.slug) {
          setBudaError("Buda connected without an agent identity. Try again.");
          return;
        }
        setShowBudaConnect(false);
        setBudaError(null);
        void queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() });
        createSession.mutate({ slug: event.data.slug });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [createSession, orpc.agents.catalog, queryClient]);

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
                <span className="flex items-center gap-1">
                  <TransportBadge transport={entry.transport} />
                  {entry.comingSoon && <Badge variant="secondary">Coming soon</Badge>}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">{entry.description}</p>
              {entry.connectedAgentName && entry.slug !== "buda" && (
                <p className="text-muted-foreground text-xs">
                  Connected to {entry.connectedAgentName}
                </p>
              )}
              {entry.comingSoon ? (
                <p className="text-muted-foreground text-xs">This integration is coming soon.</p>
              ) : entry.slug === "buda" && entry.connectionRequired ? (
                <>
                  {entry.connectedAgents.map((agent) => (
                    <div
                      key={agent.slug}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span className="truncate text-sm">{agent.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={createSession.isPending}
                        onClick={() => createSession.mutate({ slug: agent.slug })}
                      >
                        {createSession.isPending && createSession.variables?.slug === agent.slug
                          ? "Starting…"
                          : "Start session"}
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" onClick={openBudaConnect}>
                    {entry.connectedAgents.length > 0
                      ? "Connect another Buda agent"
                      : "Sign in to Buda"}
                  </Button>
                </>
              ) : entry.available ? (
                <Button
                  size="sm"
                  disabled={createSession.isPending}
                  onClick={() => createSession.mutate({ slug: entry.slug })}
                >
                  {createSession.isPending && createSession.variables?.slug === entry.slug
                    ? "Connecting…"
                    : "Connect"}
                </Button>
              ) : entry.connectionRequired ? (
                <Button size="sm" onClick={openBudaConnect}>
                  Sign in to Buda
                </Button>
              ) : (
                <p className="text-destructive text-xs">{entry.unavailableReason}</p>
              )}
            </div>
          ))}
        </div>
      </div>
      {showBudaConnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="flex w-[min(440px,95vw)] flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="font-medium text-sm">Connect Buda</p>
                <p className="text-muted-foreground text-xs">
                  Sign in and choose the agent Busabase may chat with.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowBudaConnect(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <p className="text-muted-foreground">
                Buda opens in its own secure window so your Buda login cookie stays first-party.
                After you choose an agent, this dialog closes automatically and starts the ACP chat.
              </p>
              <Button onClick={openBudaConnect}>Open Buda</Button>
              {budaError && <p className="text-destructive text-xs">{budaError}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
