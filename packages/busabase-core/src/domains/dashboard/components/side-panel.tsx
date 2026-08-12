"use client";

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "kui/context-menu";
import { cn } from "kui/utils";
import { GripVertical, Maximize2, Minimize2, PanelRight, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useSidePanelViewport } from "../hooks/use-side-panel-viewport";
import { getSidePanelTab } from "../side-panel-registry";
import {
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  SIDE_PANEL_RESIZE_CLOSE_THRESHOLD,
  useSidePanelStore,
} from "../store/side-panel-store";

/**
 * Topbar toggle for the side panel — lives in the dashboard topbar (see
 * `dashboard/index.tsx`) so it's reachable on every page regardless of
 * whether anything is pinned yet. Disabled (not hidden) when nothing is
 * pinned: there's nothing to open, but the icon stays put as a visual anchor
 * and lights up the moment something gets pinned.
 *
 * Once the panel is actually open, this button unmounts entirely — `SidePanel`
 * renders its own equivalent "Collapse" control in its header, and showing
 * both at once would be a redundant duplicate control: the topbar control
 * hides once the in-panel "Collapse" control takes over the same role.
 */
export function SidePanelToggle() {
  const messages = useCoreI18n();
  const isOpen = useSidePanelStore((state) => state.isOpen);
  const tabCount = useSidePanelStore((state) => state.tabs.length);
  const setOpen = useSidePanelStore((state) => state.setOpen);

  if (isOpen && tabCount > 0) {
    return null;
  }

  return (
    <button
      aria-label={messages.sidePanel.open}
      aria-pressed={isOpen}
      className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={tabCount === 0}
      onClick={() => setOpen(!isOpen)}
      title={messages.sidePanel.open}
      type="button"
    >
      <PanelRight className="size-4" />
    </button>
  );
}

/**
 * Right-hand panel for content the user has explicitly "pinned" so it stays
 * reachable while navigating the main canvas elsewhere (e.g. an AirApp live
 * preview — see `AirAppRunPreview`'s pin button). Renders `null` when no
 * tabs are open, or when collapsed (see `SidePanelToggle`, which owns the
 * open/collapse entry point from the topbar). Every open tab's content stays
 * mounted simultaneously (CSS-hidden when inactive) — same `forceMount`-style
 * technique `AirAppDetailView` uses for its own tabs — so switching the
 * active tab never tears down a running AirApp preview.
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
  const closeOtherTabs = useSidePanelStore((state) => state.closeOtherTabs);
  const closeAllTabs = useSidePanelStore((state) => state.closeAllTabs);
  const reorderTabs = useSidePanelStore((state) => state.reorderTabs);
  const setOpen = useSidePanelStore((state) => state.setOpen);
  const setLayout = useSidePanelStore((state) => state.setLayout);
  const setWidth = useSidePanelStore((state) => state.setWidth);
  const isMobile = useSidePanelViewport();

  const panelRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  // Live drag width — batched through rAF and written straight to the CSS
  // custom property on `panelRef` (bypassing React state) so every pointer
  // pixel doesn't trigger a full re-render. Only committed to the Zustand
  // store (a real re-render) once, on pointerup.
  const pendingWidthRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const draggedTabIdRef = useRef<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  // Suppressed during drag-resize and maximize/restore so those feel 1:1 /
  // instant instead of fighting the open-close transition.
  const [animateTransitions, setAnimateTransitions] = useState(true);

  const commitResizeFrame = useCallback(() => {
    resizeFrameRef.current = null;
    const value = pendingWidthRef.current;
    if (value === null) {
      return;
    }
    panelRef.current?.style.setProperty("--side-panel-width", `${value}px`);
  }, []);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  if (tabs.length === 0) {
    return null;
  }

  const isMaximized = layout === "maximized";
  // On narrow viewports the panel always behaves as a full-screen overlay,
  // regardless of the persisted `layout` — there's no useful "docked at a
  // clamped width" state below the mobile breakpoint.
  const isFullScreen = isMaximized || isMobile;

  const rearmTransitions = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateTransitions(true));
    });
  };

  // Collapsing (setOpen(false)) must NOT unmount this panel — its tabs (e.g. a
  // pinned AirApp preview iframe) carry live, unrecoverable client state
  // (Nodepod's in-browser dev server, in-page interaction state) that a
  // remount would discard. Always render the SAME tree (same ancestor shape
  // for every tab's Renderer) and toggle CSS visibility instead — a branch
  // that swaps in a differently-shaped tree when collapsed would make React
  // unmount/remount every Renderer across the toggle, defeating the point.
  // `tabs.length === 0` above is the only real "nothing to preserve" unmount case.
  return (
    <div
      aria-hidden={!isOpen}
      aria-label={messages.sidePanel.label}
      className={`flex h-full min-w-0 shrink-0 flex-col bg-background ${
        animateTransitions ? "transition-[width,opacity,transform] duration-300 ease-out" : ""
      } ${
        !isOpen
          ? "w-0 translate-x-4 overflow-hidden opacity-0 pointer-events-none"
          : isFullScreen
            ? "fixed inset-0 z-50 h-dvh w-full translate-x-0 opacity-100 shadow-lg"
            : "relative max-w-full translate-x-0 border-border/60 border-l opacity-100"
      }`}
      data-layout={layout}
      ref={panelRef}
      role="region"
      style={
        isOpen && !isFullScreen
          ? ({
              "--side-panel-width": `${width}px`,
              width: "min(var(--side-panel-width), 100vw)",
            } as CSSProperties)
          : undefined
      }
    >
      {!isFullScreen ? (
        <button
          aria-label={messages.sidePanel.resize}
          className={cn(
            "group absolute top-0 left-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center text-muted-foreground/50 transition-colors duration-150 hover:bg-accent/50 hover:text-foreground lg:flex",
            isResizing && "bg-accent/50 text-foreground",
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeStartRef.current = { pointerX: event.clientX, width };
            pendingWidthRef.current = width;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            setAnimateTransitions(false);
            setIsResizing(true);
          }}
          onPointerMove={(event) => {
            const start = resizeStartRef.current;
            if (!start) {
              return;
            }
            const viewportMax = Math.max(MIN_SIDE_PANEL_WIDTH, window.innerWidth - 280);
            const rawWidth = start.width + start.pointerX - event.clientX;
            pendingWidthRef.current = Math.min(
              viewportMax,
              MAX_SIDE_PANEL_WIDTH,
              Math.max(120, rawWidth),
            );
            if (resizeFrameRef.current === null) {
              resizeFrameRef.current = requestAnimationFrame(commitResizeFrame);
            }
          }}
          onPointerUp={(event) => {
            if (!resizeStartRef.current) {
              return;
            }
            resizeStartRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            setIsResizing(false);
            if (resizeFrameRef.current !== null) {
              cancelAnimationFrame(resizeFrameRef.current);
              resizeFrameRef.current = null;
            }
            const finalWidth = pendingWidthRef.current;
            pendingWidthRef.current = null;
            if (finalWidth !== null) {
              if (finalWidth < MIN_SIDE_PANEL_WIDTH - SIDE_PANEL_RESIZE_CLOSE_THRESHOLD) {
                setOpen(false);
              } else {
                setWidth(finalWidth);
              }
            }
            rearmTransitions();
          }}
          title={messages.sidePanel.resize}
          type="button"
        >
          <span
            className={cn(
              "absolute left-1/2 h-10 w-1 -translate-x-1/2 rounded-md bg-border opacity-0 transition-all duration-150 group-hover:h-14 group-hover:bg-primary/50 group-hover:opacity-100",
              isResizing && "h-16 bg-primary/60 opacity-100",
            )}
          />
          <GripVertical className="relative size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        </button>
      ) : null}
      <div className="flex min-h-11 items-center justify-between gap-1 border-border/60 border-b px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  aria-selected={tab.id === activeTabId}
                  className={cn(
                    "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                    tab.id === activeTabId
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    dragOverTabId === tab.id && "ring-1 ring-primary/50",
                  )}
                  draggable
                  onClick={() => setActiveTab(tab.id)}
                  onDragEnd={() => {
                    draggedTabIdRef.current = null;
                    setDragOverTabId(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedTabIdRef.current && draggedTabIdRef.current !== tab.id) {
                      setDragOverTabId(tab.id);
                    }
                  }}
                  onDragStart={(event) => {
                    draggedTabIdRef.current = tab.id;
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const draggedId = draggedTabIdRef.current;
                    if (draggedId && draggedId !== tab.id) {
                      reorderTabs(draggedId, tab.id);
                    }
                    draggedTabIdRef.current = null;
                    setDragOverTabId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveTab(tab.id);
                    }
                  }}
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
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                  {messages.sidePanel.closeTab}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={tabs.length <= 1}
                  onSelect={() => closeOtherTabs(tab.id)}
                >
                  {messages.sidePanel.closeOtherTabs}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => closeAllTabs()}>
                  {messages.sidePanel.closeAllTabs}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label={isMaximized ? messages.sidePanel.restore : messages.sidePanel.maximize}
            aria-pressed={isMaximized}
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              setAnimateTransitions(false);
              setLayout(isMaximized ? "split" : "maximized");
              rearmTransitions();
            }}
            title={isMaximized ? messages.sidePanel.restore : messages.sidePanel.maximize}
            type="button"
          >
            {isMaximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button
            aria-label={messages.sidePanel.collapse}
            aria-pressed={isOpen}
            className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setOpen(false)}
            title={messages.sidePanel.collapse}
            type="button"
          >
            <PanelRight className="size-4" />
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
  );
}
