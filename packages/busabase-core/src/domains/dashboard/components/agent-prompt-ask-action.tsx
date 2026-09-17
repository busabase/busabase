"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Bot, ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { useAskAgent } from "../../agents/hooks/use-ask-agent";
import type { AgentTarget } from "../../agents/utils/agent-targets";

const toAgentTarget = (connection: AgentConnectionVO): AgentTarget => ({
  slug: connection.slug,
  name: connection.agentName,
  transport: connection.transport,
  catalogSlug: connection.slug,
});

/** Prompt-specific compact split action; the full-size AskAgentAction stays unchanged. */
export function AgentPromptAskAction({
  onHandedOff,
  orpc,
  promptText,
  sessionScopeId,
}: {
  onHandedOff: () => void;
  orpc: BusabaseQueryUtils;
  promptText?: string;
  sessionScopeId: string;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingTargetName, setStartingTargetName] = useState<string | null>(null);
  const promptTextRef = useRef(promptText);
  const connections = useQuery<AgentConnectionVO[]>({
    ...orpc.agents.connections.list.queryOptions({ input: { scope: "space" } }),
  });
  const agents = (connections.data ?? []).filter((agent) => agent.connected);

  const openSetup = useCallback(() => {
    onHandedOff();
    setLocation("/agents/new");
  }, [onHandedOff, setLocation]);
  const ask = useAskAgent({
    nodeId: sessionScopeId,
    onHandedOff,
    onNoAgents: openSetup,
    orpc,
  });

  const handOffTo = (connection: AgentConnectionVO) => {
    if (!promptText) return;
    setStartingTargetName(connection.agentName);
    ask.askTarget(promptText, toAgentTarget(connection));
  };

  // A target choice always belongs to the prompt visible when it was made.
  // Drop an unfinished handoff synchronously if the user selects another prompt.
  useLayoutEffect(() => {
    if (ask.isStarting) return;
    const changed = promptTextRef.current !== promptText;
    promptTextRef.current = promptText;
    if (changed && ask.isActive) {
      setStartingTargetName(null);
      ask.reset();
    }
  }, [ask.isActive, ask.isStarting, ask.reset, promptText]);

  const handlePrimary = () => {
    if (connections.isError || agents.length > 1) {
      setMenuOpen(true);
      return;
    }
    const [only] = agents;
    if (only) handOffTo(only);
    else openSetup();
  };

  const busyLabel = ask.isStarting
    ? messages.agentPrompts.askAgentStarting
    : ask.isLoading
      ? messages.agentPrompts.askAgentLoading
      : messages.agentPrompts.askAgent;

  return (
    <div className="flex min-w-0 flex-col items-end gap-1.5">
      <div className="flex h-7 shrink-0 items-stretch rounded-md bg-secondary text-secondary-foreground">
        <Button
          className="h-7 gap-1.5 rounded-r-none px-2.5 text-xs shadow-none"
          disabled={!promptText || connections.isPending || ask.isLoading || ask.isStarting}
          onClick={handlePrimary}
          size="sm"
          type="button"
          variant="secondary"
        >
          {connections.isPending || ask.isLoading || ask.isStarting ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <Sparkles aria-hidden />
          )}
          {busyLabel}
        </Button>
        <span aria-hidden className="my-1 w-px shrink-0 bg-border" />
        <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={messages.agentPrompts.askAgentOptions}
              className="h-7 w-7 rounded-l-none px-0 shadow-none"
              disabled={ask.isLoading || ask.isStarting}
              size="icon-sm"
              title={messages.agentPrompts.askAgentOptions}
              type="button"
              variant="secondary"
            >
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
            {connections.isPending ? (
              <DropdownMenuItem disabled>
                <Loader2 className="animate-spin" />
                {messages.agentPrompts.askAgentLoading}
              </DropdownMenuItem>
            ) : connections.isError ? (
              <DropdownMenuItem onSelect={() => void connections.refetch()}>
                <Bot />
                {messages.agentPrompts.askAgentRetry}
              </DropdownMenuItem>
            ) : agents.length === 0 ? (
              <DropdownMenuItem onSelect={openSetup}>
                <Bot />
                {messages.agentPrompts.noAgents}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuLabel>{messages.agentPrompts.askAgentDirectly}</DropdownMenuLabel>
                {agents.map((agent) => (
                  <DropdownMenuItem key={agent.slug} onSelect={() => handOffTo(agent)}>
                    <Bot />
                    <span className="min-w-0 flex-1 truncate">{agent.agentName}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {ask.isLoading || ask.isStarting ? (
        <p aria-live="polite" className="text-muted-foreground text-xs" role="status">
          {startingTargetName ? `${startingTargetName} — ` : null}
          {ask.isStarting
            ? messages.agentPrompts.askAgentStarting
            : messages.agentPrompts.askAgentLoading}
        </p>
      ) : null}
      {ask.loadError || ask.startError ? (
        <div className="flex max-w-72 items-center gap-2 text-destructive text-xs" role="alert">
          <span className="min-w-0 flex-1 truncate" title={ask.startError ?? undefined}>
            {ask.startError ?? messages.agentPrompts.askAgentLoadFailed}
          </span>
          <button
            className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={ask.retry}
            type="button"
          >
            {messages.agentPrompts.askAgentRetry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
