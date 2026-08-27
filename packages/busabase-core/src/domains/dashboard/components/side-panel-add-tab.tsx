"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Bot, Clock, Pin, Plus, Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useCoreI18n } from "../../../i18n";
import type { KnownNodeCache } from "../helpers/known-node-cache";
import { nodeIconForType } from "../helpers/node-icons";
import {
  isPinnableNode,
  openAgentChatTab,
  type PinnableNode,
  pinNodeToSidePanel,
  pinnableRecents,
} from "./side-panel-sources";

const RECENT_LIMIT = 8;

export interface SidePanelAddTabProps {
  orpc: BusabaseQueryUtils;
  /** The node the user is currently looking at, or null off a node page. */
  currentNode: PinnableNode | null;
  /** Scoped cache instance from the dashboard — never the module default. */
  nodeCache: KnownNodeCache;
  /** Opens the command palette in "pin" mode. */
  onOpenSearch: () => void;
  /** Navigates, e.g. to `/agents/new` when nothing is connected yet. */
  onNavigate: (path: string) => void;
}

/**
 * The "+" in the side panel's tab strip: everything you can put in the panel.
 *
 * The panel shows *nodes you already have* rather than things it creates, so
 * this menu is four ways of answering "which one" — the one you're looking at,
 * one you search for, one you saw recently, or an agent conversation.
 */
export function SidePanelAddTab({
  orpc,
  currentNode,
  nodeCache,
  onOpenSearch,
  onNavigate,
}: SidePanelAddTabProps) {
  const messages = useCoreI18n();

  const snapshot = useSyncExternalStore(
    nodeCache.subscribe,
    nodeCache.getSnapshot,
    nodeCache.getSnapshot,
  );
  const recents = pinnableRecents(snapshot.visited, RECENT_LIMIT);

  // Connected agent backends, not the catalog of connectable ones — the menu
  // offers conversations, and you can only converse with something connected.
  const connections = useQuery(orpc.agents.connections.list.queryOptions());
  const agents = connections.data ?? [];

  // A node page can be open on a type the panel has no renderer for, in which
  // case "pin this page" is present but inert rather than silently missing.
  const canPinCurrent = currentNode !== null && isPinnableNode(currentNode.type);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={messages.sidePanel.newTab}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={messages.sidePanel.newTab}
          type="button"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!canPinCurrent}
          onSelect={() => {
            if (currentNode) {
              pinNodeToSidePanel(currentNode);
            }
          }}
        >
          <Pin className="size-4" />
          <span className="flex-1 truncate">
            {canPinCurrent ? currentNode.name : messages.sidePanel.pinCurrent}
          </span>
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={onOpenSearch}>
          <Search className="size-4" />
          <span className="flex-1">{messages.sidePanel.search}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Clock className="size-4" />
            <span className="flex-1">{messages.sidePanel.recent}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {recents.length === 0 ? (
              <DropdownMenuItem disabled>{messages.sidePanel.noRecent}</DropdownMenuItem>
            ) : (
              recents.map((node) => {
                const Icon = nodeIconForType(node.type);
                return (
                  <DropdownMenuItem
                    key={node.id}
                    onSelect={() =>
                      pinNodeToSidePanel({ id: node.id, type: node.type, name: node.name })
                    }
                  >
                    <Icon className="size-4" />
                    <span className="flex-1 truncate">{node.name}</span>
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Bot className="size-4" />
            <span className="flex-1">{messages.sidePanel.agents}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {agents.length === 0 ? (
              <DropdownMenuItem onSelect={() => onNavigate("/agents/new")}>
                <Bot className="size-4" />
                <span className="flex-1">{messages.sidePanel.noAgents}</span>
              </DropdownMenuItem>
            ) : (
              agents.map((agent) => (
                <DropdownMenuItem
                  key={agent.slug}
                  onSelect={() => openAgentChatTab(agent.slug, agent.agentName, agent.latest?.id)}
                >
                  <Bot className="size-4" />
                  <span className="flex-1 truncate">{agent.agentName}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
