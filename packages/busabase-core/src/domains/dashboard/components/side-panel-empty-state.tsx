"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { cn } from "kui/utils";
import type { LucideIcon } from "lucide-react";
import { Bot, ChevronLeft, ChevronRight, Loader2, Pin, Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useCoreI18n } from "../../../i18n";
import type { KnownNodeCache } from "../helpers/known-node-cache";
import { NodeAvatar } from "../helpers/node-icons";
import {
  isPinnableNode,
  openAgentChatTab,
  type PinnableNode,
  pinNodeToSidePanel,
  pinnableRecents,
} from "./side-panel-sources";

const RECENT_LIMIT = 6;

export interface SidePanelEmptyStateProps {
  currentNode: PinnableNode | null;
  nodeCache: KnownNodeCache;
  onOpenSearch: () => void;
  onOpenAgents: () => void;
}

interface LauncherCard {
  key: string;
  Icon: LucideIcon;
  label: string;
  description: string;
  disabled: boolean;
  onSelect: () => void;
  /** Whether this card leads to another selection step rather than acting immediately. */
  hasNextStep: boolean;
}

/**
 * What the panel shows with nothing pinned.
 *
 * This is not decoration around an "empty" message — it is the panel's primary
 * entry point, and the reason the toggle can now be opened at any time. Every
 * card here has a twin in the "+" menu; both read from `side-panel-sources` so
 * they cannot drift apart.
 */
export function SidePanelEmptyState({
  currentNode,
  nodeCache,
  onOpenSearch,
  onOpenAgents,
}: SidePanelEmptyStateProps) {
  const messages = useCoreI18n();

  const snapshot = useSyncExternalStore(
    nodeCache.subscribe,
    nodeCache.getSnapshot,
    nodeCache.getSnapshot,
  );
  const recents = pinnableRecents(snapshot.visited, RECENT_LIMIT);

  const canPinCurrent = currentNode !== null && isPinnableNode(currentNode.type);

  const cards: LauncherCard[] = [
    {
      key: "current",
      Icon: Pin,
      label: messages.sidePanel.pinCurrent,
      // Names the page you're on when there is one, so the card says what it
      // will actually do rather than describing the feature in the abstract.
      description: canPinCurrent ? currentNode.name : messages.sidePanel.pinCurrentHint,
      disabled: !canPinCurrent,
      hasNextStep: false,
      onSelect: () => {
        if (currentNode) {
          pinNodeToSidePanel(currentNode);
        }
      },
    },
    {
      key: "search",
      Icon: Search,
      label: messages.sidePanel.search,
      description: messages.sidePanel.cardSearch,
      disabled: false,
      hasNextStep: false,
      onSelect: onOpenSearch,
    },
    {
      key: "agents",
      Icon: Bot,
      label: messages.sidePanel.agents,
      description: messages.sidePanel.cardAgents,
      disabled: false,
      // Picking "Agents" is a category, not an action — it leads to a second
      // step (choosing which connected agent), so the card says so up front
      // rather than surprising the user with another list after the click.
      hasNextStep: true,
      onSelect: onOpenAgents,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div className="space-y-1">
        <p className="font-medium text-foreground text-sm">{messages.sidePanel.emptyTitle}</p>
        <p className="text-muted-foreground text-xs">{messages.sidePanel.emptyDescription}</p>
      </div>

      <div className="flex flex-col gap-2">
        {cards.map((card) => (
          <button
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors",
              card.disabled
                ? "cursor-not-allowed opacity-50"
                : "hover:border-border hover:bg-accent/50",
            )}
            disabled={card.disabled}
            key={card.key}
            onClick={card.onSelect}
            type="button"
          >
            <card.Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground text-xs">
                {card.label}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                {card.description}
              </span>
            </span>
            {card.hasNextStep ? (
              <ChevronRight
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            ) : null}
          </button>
        ))}
      </div>

      {recents.length > 0 ? (
        <div className="space-y-1.5">
          <p className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {messages.sidePanel.recent}
          </p>
          <div className="flex flex-col">
            {recents.map((node) => (
              <button
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                key={node.id}
                onClick={() =>
                  pinNodeToSidePanel({ id: node.id, type: node.type, name: node.name })
                }
                type="button"
              >
                {/* Same avatar resolution every other Recent list uses — this
                    panel reads the identical `KnownNodeCache` data. */}
                <span className="flex size-4 shrink-0 items-center justify-center overflow-hidden text-muted-foreground">
                  <NodeAvatar node={node} />
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground text-xs">{node.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface SidePanelAgentPickerProps {
  orpc: BusabaseQueryUtils;
  /** Returns to the empty-state launcher without picking an agent. */
  onBack: () => void;
  /** Navigates, e.g. to `/agents/new` when nothing is connected yet. */
  onNavigate: (path: string) => void;
}

/**
 * The Agents launcher card's second step: which connected agent to talk to.
 *
 * Reads the same `agents.connections.list` query (scope: "space") the "+"
 * Agents submenu uses, and selecting a row calls the same `openAgentChatTab`
 * — so a conversation opened from either entry point lands in the identical
 * tab, never a second chat implementation. `onBack` is the only way out
 * other than actually picking one, mirroring the disclosure pattern the "+"
 * submenu already gets for free from being a menu.
 */
export function SidePanelAgentPicker({ orpc, onBack, onNavigate }: SidePanelAgentPickerProps) {
  const messages = useCoreI18n();

  const connections = useQuery(
    orpc.agents.connections.list.queryOptions({ input: { scope: "space" } }),
  );
  const agents = connections.data ?? [];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <button
          aria-label={messages.sidePanel.agentPickerBack}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}
          title={messages.sidePanel.agentPickerBack}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="font-medium text-foreground text-sm">
          {messages.sidePanel.agentPickerTitle}
        </h2>
      </div>

      {connections.isPending ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 px-1 text-muted-foreground text-xs"
          role="status"
        >
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          {messages.sidePanel.agentPickerLoading}
        </p>
      ) : connections.isError ? (
        <div className="space-y-2 px-1">
          <p className="text-muted-foreground text-xs">{messages.sidePanel.agentPickerError}</p>
          <button
            className="text-primary text-xs underline-offset-2 hover:underline"
            onClick={() => void connections.refetch()}
            type="button"
          >
            {messages.sidePanel.agentPickerRetry}
          </button>
        </div>
      ) : agents.length === 0 ? (
        <div className="space-y-2 px-1">
          <p className="text-muted-foreground text-xs">{messages.sidePanel.agentPickerEmpty}</p>
          <button
            className="text-primary text-xs underline-offset-2 hover:underline"
            onClick={() => onNavigate("/agents/new")}
            type="button"
          >
            {messages.sidePanel.agentPickerConnect}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <button
              className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-left transition-colors hover:border-border hover:bg-accent/50"
              key={agent.slug}
              onClick={() =>
                openAgentChatTab(agent.slug, agent.agentName, {
                  sessionId: agent.latest?.id,
                })
              }
              type="button"
            >
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground text-xs">
                {agent.agentName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
