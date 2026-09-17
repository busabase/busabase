"use client";

// The agent entry point as a FIRST-CLASS split button, next to Pin and the
// "•••" menu on every node-detail header. Agent Prompts remains the default
// action; the chevron exposes the faster path into a connected Agent chat.
//
// Why it was promoted out of `NodeActionsMenu`: Busabase's premise is that you
// drive your knowledge base through your own agent, and for some node types
// (Form above all — its page is agent-authored HTML with no GUI builder) the
// prompt list is not a convenience, it is the primary way to change the thing.
// An entry point that costs a click into an unlabelled "•••" is one most people
// never find. It lives in exactly ONE place per toolbar: the dropdown item is
// gone, so this button and that menu can't drift apart.
//
// The sidebar row keeps its own menu item — a sidebar row has no toolbar to put
// a button in, and it opens the same dialog (see `dashboard-shell.tsx`'s
// `onOpenAgentPrompts`).

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
import { useState } from "react";
import { useLocation } from "wouter";
import { useCoreI18n } from "../../../i18n";
import type { NodePromptScope } from "../helpers/node-agent-prompts";
import { useDashboardOrpc } from "../orpc-context";
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";
import { openAgentChatTab } from "./side-panel-sources";

export function NodeAgentPromptsButton({
  nodeId,
  nodeName,
  nodeType,
  scope,
  spaceId,
  spaceName,
  orpc,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Narrows the prompts to one column or one record. Omit for the whole node. */
  scope?: NodePromptScope;
  spaceId?: string;
  spaceName?: string;
  /**
   * Explicit query utils for hosts outside `DashboardOrpcProvider`. Scoped
   * callers may pass `null`; the dropdown and dialog handoff still use the
   * dashboard context, while the dialog gates custom-prompt reads by scope.
   */
  orpc: BusabaseQueryUtils | null;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Connected-Agent actions are independent of whether node-level custom
  // prompts apply to this scope. Record toolbars therefore use the same
  // dashboard client as whole-node toolbars even though their dialog skips the
  // custom-prompt query.
  const orpcFromContext = useDashboardOrpc();
  const orpcForDropdown = orpc ?? orpcFromContext;
  const connectionsOptions = orpcForDropdown?.agents.connections.list.queryOptions({
    input: { scope: "space" },
  });
  const connections = useQuery<AgentConnectionVO[]>({
    ...(connectionsOptions ?? {
      queryKey: ["agent-connections", "unavailable", nodeId],
      queryFn: async () => [],
    }),
    enabled: Boolean(orpcForDropdown && menuOpen),
  });
  const agents = (connections.data ?? []).filter((agent) => agent.connected);
  // A public-link visitor has no agent to drive this workspace with, and every
  // prompt is phrased as an instruction to change it — same self-gate the other
  // action buttons in this domain use.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  return (
    <>
      <div className="flex h-8 shrink-0 items-stretch rounded-md bg-ai/10 text-ai-strong dark:text-ai-soft">
        <Button
          aria-label={messages.agentPrompts.title}
          aria-expanded={dialogOpen}
          className={`h-8 gap-1.5 px-2.5 text-ai-strong shadow-none hover:bg-ai/17 hover:text-ai-strong data-[state=open]:bg-ai/17 dark:text-ai-soft dark:hover:text-ai-soft ${orpcForDropdown ? "rounded-r-none" : ""}`}
          data-testid="node-agent-prompts-button"
          data-state={dialogOpen ? "open" : "closed"}
          onClick={() => setDialogOpen(true)}
          size="sm"
          title={messages.agentPrompts.title}
          type="button"
          variant="ghost"
        >
          <Sparkles aria-hidden="true" className="size-3.5" />
          <span className="hidden sm:inline">{messages.agentPrompts.title}</span>
        </Button>
        {orpcForDropdown ? (
          <>
            <span aria-hidden="true" className="my-1.5 w-px shrink-0 bg-ai/20" />
            <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={messages.agentPrompts.askAgentOptions}
                  className="h-8 w-7 rounded-l-none px-0 text-ai-strong shadow-none hover:bg-ai/17 hover:text-ai-strong data-[state=open]:bg-ai/17 dark:text-ai-soft dark:hover:text-ai-soft"
                  data-testid="node-agent-actions-trigger"
                  size="icon-sm"
                  title={messages.agentPrompts.askAgentOptions}
                  type="button"
                  variant="ghost"
                >
                  <ChevronDown aria-hidden="true" className="size-3.5" />
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
                  <DropdownMenuItem onSelect={() => setLocation("/agents/new")}>
                    <Bot />
                    {messages.agentPrompts.noAgents}
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuLabel>{messages.agentPrompts.askAgentDirectly}</DropdownMenuLabel>
                    {agents.map((agent) => (
                      <DropdownMenuItem
                        key={agent.slug}
                        onSelect={() =>
                          openAgentChatTab(agent.slug, agent.agentName, {
                            sessionId: agent.latest?.id,
                          })
                        }
                      >
                        <Bot />
                        <span className="flex-1 truncate">{agent.agentName}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
      {dialogOpen && (
        <NodeAgentPromptsDialog
          orpc={orpc}
          nodeId={nodeId}
          nodeName={nodeName}
          nodeType={nodeType}
          onOpenChange={setDialogOpen}
          open={dialogOpen}
          scope={scope}
          spaceId={spaceId}
          spaceName={spaceName}
        />
      )}
    </>
  );
}
