"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useCoreI18n } from "../../../i18n";
import { getSidePanelTab } from "../side-panel-registry";
import { useSidePanelStore } from "../store/side-panel-store";

/**
 * Right-hand panel for content the user has explicitly "pinned" so it stays
 * reachable while navigating the main canvas elsewhere (e.g. an AirApp live
 * preview — see `AirAppRunPreview`'s pin button). Renders `null` when no
 * tabs are open so the main canvas gets full width until something is
 * pinned. Every open tab's content stays mounted simultaneously (CSS-hidden
 * when inactive) — same `forceMount`-style technique `AirAppDetailView` uses
 * for its own tabs — so switching the active tab never tears down a running
 * AirApp preview.
 */
export function SidePanel({ orpc }: { orpc: BusabaseQueryUtils }) {
  const messages = useCoreI18n();
  const isOpen = useSidePanelStore((state) => state.isOpen);
  const activeTabId = useSidePanelStore((state) => state.activeTabId);
  const tabs = useSidePanelStore((state) => state.tabs);
  const setActiveTab = useSidePanelStore((state) => state.setActiveTab);
  const closeTab = useSidePanelStore((state) => state.closeTab);
  const setOpen = useSidePanelStore((state) => state.setOpen);

  if (tabs.length === 0) {
    return null;
  }

  if (!isOpen) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center border-border/60 border-l bg-muted/10 py-2">
        <button
          aria-label={messages.sidePanel.open}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(true)}
          title={messages.sidePanel.open}
          type="button"
        >
          <PanelRightOpen className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-[420px] shrink-0 flex-col border-border/60 border-l bg-background">
      <div className="flex min-h-11 items-center justify-between gap-1 border-border/60 border-b px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <div
              aria-selected={tab.id === activeTabId}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                tab.id === activeTabId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              tabIndex={0}
            >
              <span className="max-w-[140px] truncate">{tab.title}</span>
              <button
                aria-label={messages.sidePanel.closeTab}
                className="rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                title={messages.sidePanel.closeTab}
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          aria-label={messages.sidePanel.collapse}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(false)}
          title={messages.sidePanel.collapse}
          type="button"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => {
          const Renderer = getSidePanelTab(tab.type);
          if (!Renderer) {
            console.warn(`SidePanel: no renderer registered for tab type "${tab.type}"`);
          }
          return (
            <div className={tab.id === activeTabId ? "block h-full" : "hidden"} key={tab.id}>
              {Renderer ? <Renderer orpc={orpc} payload={tab.payload} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
