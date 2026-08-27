"use client";

import { cn } from "kui/utils";
import type { LucideIcon } from "lucide-react";
import { Bot, Pin, Search } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useCoreI18n } from "../../../i18n";
import type { KnownNodeCache } from "../helpers/known-node-cache";
import { nodeIconForType } from "../helpers/node-icons";
import {
  isPinnableNode,
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
      onSelect: onOpenSearch,
    },
    {
      key: "agents",
      Icon: Bot,
      label: messages.sidePanel.agents,
      description: messages.sidePanel.cardAgents,
      disabled: false,
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
          </button>
        ))}
      </div>

      {recents.length > 0 ? (
        <div className="space-y-1.5">
          <p className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {messages.sidePanel.recent}
          </p>
          <div className="flex flex-col">
            {recents.map((node) => {
              const Icon = nodeIconForType(node.type);
              return (
                <button
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50"
                  key={node.id}
                  onClick={() =>
                    pinNodeToSidePanel({ id: node.id, type: node.type, name: node.name })
                  }
                  type="button"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground text-xs">
                    {node.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
