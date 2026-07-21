"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  GripVertical,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useCoreI18n } from "../../../i18n";
import { getSidePanelTab } from "../side-panel-registry";
import {
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  useSidePanelStore,
} from "../store/side-panel-store";

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
  const layout = useSidePanelStore((state) => state.layout);
  const width = useSidePanelStore((state) => state.width);
  const activeTabId = useSidePanelStore((state) => state.activeTabId);
  const tabs = useSidePanelStore((state) => state.tabs);
  const setActiveTab = useSidePanelStore((state) => state.setActiveTab);
  const closeTab = useSidePanelStore((state) => state.closeTab);
  const setOpen = useSidePanelStore((state) => state.setOpen);
  const setLayout = useSidePanelStore((state) => state.setLayout);
  const setWidth = useSidePanelStore((state) => state.setWidth);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  if (tabs.length === 0) {
    return null;
  }

  const isMaximized = layout === "maximized";

  return (
    <>
      {!isOpen ? (
        <div className="flex h-full w-9 shrink-0 flex-col items-center border-border/60 border-l bg-muted/10 py-2">
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
      ) : null}
      <div
        aria-label={messages.sidePanel.label}
        className={
          !isOpen
            ? "hidden"
            : isMaximized
              ? "fixed inset-0 z-50 flex h-dvh w-full flex-col bg-background shadow-lg"
              : "relative flex h-full min-w-0 max-w-full shrink-0 flex-col border-border/60 border-l bg-background"
        }
        data-layout={layout}
        role="region"
        style={isMaximized || !isOpen ? undefined : { width: `min(${width}px, 100vw)` }}
      >
        {!isMaximized ? (
          <button
            aria-label={messages.sidePanel.resize}
            className="group absolute top-0 left-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center text-muted-foreground/50 hover:bg-accent/50 hover:text-foreground md:flex"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizeStartRef.current = { pointerX: event.clientX, width };
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            onPointerMove={(event) => {
              const start = resizeStartRef.current;
              if (!start) {
                return;
              }
              const viewportMax = Math.max(MIN_SIDE_PANEL_WIDTH, window.innerWidth - 280);
              setWidth(
                Math.min(
                  viewportMax,
                  MAX_SIDE_PANEL_WIDTH,
                  start.width + start.pointerX - event.clientX,
                ),
              );
            }}
            onPointerUp={(event) => {
              if (!resizeStartRef.current) {
                return;
              }
              resizeStartRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            }}
            title={messages.sidePanel.resize}
            type="button"
          >
            <GripVertical className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : null}
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label={isMaximized ? messages.sidePanel.restore : messages.sidePanel.maximize}
              aria-pressed={isMaximized}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setLayout(isMaximized ? "split" : "maximized")}
              title={isMaximized ? messages.sidePanel.restore : messages.sidePanel.maximize}
              type="button"
            >
              {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              aria-label={messages.sidePanel.collapse}
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setOpen(false)}
              title={messages.sidePanel.collapse}
              type="button"
            >
              <PanelRightClose className="size-4" />
            </button>
          </div>
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
    </>
  );
}
