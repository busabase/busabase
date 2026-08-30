"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Button } from "kui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "kui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { cn } from "kui/utils";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import type React from "react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface SettingsShellTab<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

export interface SettingsShellSection<T extends string = string> {
  /** Stable key for accordion expand/collapse. Falls back to `title` when omitted. */
  key?: string;
  title: string;
  /** Icon shown on the accordion section header. */
  icon?: LucideIcon;
  /**
   * Optional node rendered inside the expanded section, above its tabs
   * (accordion mode). e.g. the Agent picker for the Agent settings section.
   */
  headerNode?: React.ReactNode;
  tabs: SettingsShellTab<T>[];
}

export interface SettingsDialogShellProps<T extends string = string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (visually hidden) */
  title: string;
  /** Localized label for the close button (visible to screen readers only). */
  closeLabel: string;
  /**
   * Localized label for the mobile drill-down's back button. Only rendered
   * below the `sm` breakpoint, where picking a tab replaces the section list
   * with that tab's content. Defaults to "Back" so callers that never render
   * at mobile width don't have to supply it.
   */
  backLabel?: string;
  /** Optional trigger element rendered inside the Dialog */
  trigger?: React.ReactNode;
  /** Fixed height on desktop in px. Defaults to 640. */
  desktopHeight?: number;
  /**
   * Tab groups shown in the sidebar.
   * Pass a single-element array for a flat (ungrouped) sidebar.
   */
  sections: SettingsShellSection<T>[];
  activeTab: T;
  /**
   * Called when the user picks a tab. `sectionKey` identifies which
   * `SettingsShellSection` the clicked tab belongs to — required because tab
   * `id`s are only unique WITHIN a section (e.g. two sections may each have a
   * "general" tab), so the id alone can't disambiguate which section the
   * click came from once sections are flattened into one row (mobile) or
   * dropdown (breadcrumb tab-jump).
   */
  onTabChange: (tab: T, sectionKey: string) => void;
  /**
   * Accordion mode: section headers become clickable; only the expanded
   * section (`activeSectionKey`) shows its tabs. Requires `activeSectionKey`
   * and `onSectionChange`.
   */
  accordion?: boolean;
  /** Key of the currently expanded section (accordion mode). */
  activeSectionKey?: string;
  /** Called when the user clicks a collapsed section header (accordion mode). */
  onSectionChange?: (key: string) => void;
  /**
   * Optional middle crumb inserted between the section title and the tab label
   * in the breadcrumb. Pass a string for plain text, or a node (e.g. an agent
   * picker dropdown) for an interactive crumb.
   */
  breadcrumbMiddle?: React.ReactNode;
  /**
   * Tabs whose content area should be full-bleed (no padding, no scroll).
   * e.g. ["skills"]
   */
  fullBleedTabs?: T[];
  /**
   * Optional CSS class applied to the shell's scrollable regions (mobile tab
   * row, desktop sidebar, main content pane) for a host-supplied custom
   * scrollbar look (e.g. a hover-visible thin scrollbar utility). Defaults to
   * "" (browser default scrollbar) since this package carries no shared CSS.
   */
  scrollbarClassName?: string;
  /** Optional desktop-only actions pinned to the bottom of the sidebar. */
  sidebarFooter?: React.ReactNode;
  /** Optional content rendered above the section list in the sidebar (desktop only). */
  sidebarHeader?: React.ReactNode;
  children: React.ReactNode;
}

interface SettingsDialogActionsContextValue {
  setActions: (actions: React.ReactNode) => void;
  closeDialog: () => void;
}

const SettingsDialogActionsContext = createContext<SettingsDialogActionsContextValue | null>(null);

export function useSettingsDialogActions() {
  const context = useContext(SettingsDialogActionsContext);
  return context;
}

interface OverflowTooltipNavItemProps {
  label: string;
  children: (labelNode: React.ReactNode) => React.ReactElement;
}

const OverflowTooltipNavItem = ({ label, children }: OverflowTooltipNavItemProps) => {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const labelElement = labelRef.current;
    if (!labelElement) return;

    const updateOverflow = () => {
      if (labelElement.textContent !== label) return;
      setIsOverflowing(labelElement.scrollWidth > labelElement.clientWidth);
    };

    updateOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(labelElement);

    return () => resizeObserver.disconnect();
  }, [label]);

  const labelNode = (
    <span
      ref={labelRef}
      className="min-w-0 flex-1 truncate text-left"
      data-settings-sidebar-label={label}
    >
      {label}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children(labelNode)}</TooltipTrigger>
      {isOverflowing && (
        <TooltipPrimitive.Portal>
          <TooltipContent
            side="right"
            align="center"
            sideOffset={8}
            className="z-[9999] max-w-72 whitespace-normal"
          >
            <span className="break-words text-xs">{label}</span>
          </TooltipContent>
        </TooltipPrimitive.Portal>
      )}
    </Tooltip>
  );
};

// ── Shell ──────────────────────────────────────────────────────────────

export function SettingsDialogShell<T extends string = string>({
  open,
  onOpenChange,
  title,
  closeLabel,
  backLabel = "Back",
  trigger,
  desktopHeight = 640,
  sections,
  activeTab,
  onTabChange,
  accordion = false,
  activeSectionKey,
  onSectionChange,
  breadcrumbMiddle,
  fullBleedTabs = [],
  scrollbarClassName = "",
  sidebarFooter,
  sidebarHeader,
  children,
}: SettingsDialogShellProps<T>) {
  const isFullBleed = fullBleedTabs.includes(activeTab);
  const allTabs = sections.flatMap((s) => s.tabs);
  const [actions, setActions] = useState<React.ReactNode>(null);
  // Mobile-only: whether the user has drilled into a tab's content (vs. still
  // browsing the section/tab list). Irrelevant on sm: and up, where sidebar +
  // content always show side by side.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  useEffect(() => {
    if (open) setMobileDetailOpen(false);
  }, [open]);

  const sectionKeyOf = (s: SettingsShellSection<T>) => s.key ?? s.title;
  // Resolve which section owns the current view for the breadcrumb.
  const activeSection = accordion
    ? sections.find((s) => sectionKeyOf(s) === activeSectionKey)
    : (sections.find((s) => s.tabs.some((t) => t.id === activeTab)) ?? sections[0]);
  // Resolve the tab label from the ACTIVE section's tabs — tab ids can collide
  // across sections (space + agent both have "general"), so searching all tabs
  // would pick the wrong label.
  const activeSectionTabs = activeSection?.tabs ?? [];
  const activeTabLabel =
    activeSectionTabs.find((t) => t.id === activeTab)?.label ??
    allTabs.find((t) => t.id === activeTab)?.label;
  const otherSections = accordion
    ? sections.filter((s) => sectionKeyOf(s) !== activeSectionKey)
    : [];

  const breadcrumb =
    activeSection && activeTabLabel ? (
      <nav
        aria-label="breadcrumb"
        className="flex items-center gap-0.5 text-xs text-muted-foreground"
      >
        {/* Section crumb — dropdown to jump to another top-level section */}
        {accordion && onSectionChange && otherSections.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors hover:bg-accent/50 hover:text-foreground focus:outline-none"
              >
                {activeSection.title}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {otherSections.map((s) => {
                const k = sectionKeyOf(s);
                const Icon = s.icon;
                return (
                  <DropdownMenuItem key={k} onClick={() => onSectionChange(k)} className="gap-2">
                    {Icon && <Icon className="h-4 w-4" />}
                    {s.title}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="px-1.5 py-0.5">{activeSection.title}</span>
        )}

        {breadcrumbMiddle && (
          <>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
            {typeof breadcrumbMiddle === "string" ? (
              <span className="px-1.5 py-0.5 truncate">{breadcrumbMiddle}</span>
            ) : (
              breadcrumbMiddle
            )}
          </>
        )}

        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />

        {/* Tab crumb — dropdown to jump to another tab in the current section */}
        {activeSectionTabs.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-accent/50 focus:outline-none"
              >
                {activeTabLabel}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {activeSectionTabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  onClick={() => activeSection && onTabChange(tab.id, sectionKeyOf(activeSection))}
                  className={cn("gap-2", tab.id === activeTab && "bg-accent")}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="px-1.5 py-0.5 font-medium text-foreground">{activeTabLabel}</span>
        )}
      </nav>
    ) : null;
  const actionsContextValue = useMemo(
    () => ({ setActions, closeDialog: () => onOpenChange(false) }),
    [onOpenChange],
  );

  // Shared section/tab nav list — used for the desktop sidebar as-is, and
  // reused full-width as the mobile "browse" screen (onTabSelected drills
  // into the "detail" screen there; desktop passes nothing, unaffected).
  const renderSectionList = (onTabSelected?: () => void) => (
    <>
      {sections.map((section, i) => {
        const key = sectionKeyOf(section);
        const expanded = accordion ? key === activeSectionKey : true;
        const SectionIcon = section.icon;
        return (
          <div
            key={key}
            className={cn(
              accordion && expanded && "mb-1",
              !accordion && i < sections.length - 1 && "mb-4",
            )}
          >
            {accordion ? (
              // ── Level 1: section header ──
              // Group-title styling (not a plain nav row) so the parent/
              // child hierarchy reads clearly against the level-2 tabs.
              <OverflowTooltipNavItem label={section.title}>
                {(labelNode) => (
                  <button
                    type="button"
                    onClick={() => !expanded && onSectionChange?.(key)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors",
                      expanded
                        ? "cursor-default font-semibold text-foreground"
                        : "font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    {SectionIcon && (
                      <SectionIcon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          expanded ? "text-foreground" : "text-muted-foreground",
                        )}
                      />
                    )}
                    {labelNode}
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    )}
                  </button>
                )}
              </OverflowTooltipNavItem>
            ) : (
              <h3 className="text-xs font-normal text-muted-foreground/60 uppercase tracking-wider px-2 mb-2">
                {section.title}
              </h3>
            )}
            {expanded && accordion && section.headerNode && (
              <div className="mt-1.5 mb-1 px-1">{section.headerNode}</div>
            )}
            {expanded &&
              (accordion ? (
                // ── Level 2: tabs grouped under a vertical guide rail ──
                <div className="mt-1 ml-[15px] flex flex-col gap-0.5 border-l border-border/60 pl-2">
                  {section.tabs.map((tab) => (
                    <OverflowTooltipNavItem key={tab.id} label={tab.label}>
                      {(labelNode) => (
                        <Button
                          variant="ghost"
                          className={cn(
                            "h-8 w-full justify-start gap-2 px-2 text-[13px] font-normal",
                            activeTab === tab.id
                              ? "bg-accent text-accent-foreground hover:bg-accent"
                              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                          )}
                          onClick={() => {
                            onTabChange(tab.id, key);
                            onTabSelected?.();
                          }}
                        >
                          <tab.icon className="h-4 w-4 shrink-0" />
                          {labelNode}
                        </Button>
                      )}
                    </OverflowTooltipNavItem>
                  ))}
                </div>
              ) : (
                section.tabs.map((tab) => (
                  <OverflowTooltipNavItem key={tab.id} label={tab.label}>
                    {(labelNode) => (
                      <Button
                        variant="ghost"
                        className={cn(
                          "h-9 w-full justify-start gap-2 font-normal",
                          activeTab === tab.id
                            ? "bg-accent text-accent-foreground hover:bg-accent"
                            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                        )}
                        onClick={() => {
                          onTabChange(tab.id, key);
                          onTabSelected?.();
                        }}
                      >
                        <tab.icon className="h-4 w-4 shrink-0" />
                        {labelNode}
                      </Button>
                    )}
                  </OverflowTooltipNavItem>
                ))
              ))}
          </div>
        );
      })}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        showCloseButton={false}
        className="w-[min(96vw,1020px)] sm:max-w-[1020px] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl h-[80vh] sm:h-auto"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>

        <div className="absolute right-3 top-3 z-20 flex items-center gap-1">
          {actions}
          <DialogClose className="inline-flex size-8 items-center justify-center rounded-md text-foreground/70 ring-offset-background transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogClose>
        </div>

        <SettingsDialogActionsContext.Provider value={actionsContextValue}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            {/* Mobile: full-page section/tab list ("browse"), replaced by the
                content pane ("detail") once a tab is picked — see mobileDetailOpen. */}
            <div
              data-settings-viewport="mobile"
              className={cn(
                "sm:hidden min-h-0 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 pt-14",
                scrollbarClassName,
                mobileDetailOpen ? "hidden" : "flex flex-1",
              )}
            >
              <TooltipProvider delayDuration={300}>
                {sidebarHeader && <div className="mb-3">{sidebarHeader}</div>}
                {renderSectionList(() => setMobileDetailOpen(true))}
              </TooltipProvider>
              {sidebarFooter && (
                <div className="mt-3 shrink-0 border-t pt-3 space-y-1">{sidebarFooter}</div>
              )}
            </div>

            {/* Mobile: back bar shown only while browsing a tab's content. */}
            {mobileDetailOpen && (
              <div className="sm:hidden flex shrink-0 items-center gap-2 border-b py-2 pl-3 pr-12">
                <button
                  type="button"
                  onClick={() => setMobileDetailOpen(false)}
                  className="flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" />
                  {backLabel}
                </button>
                {activeTabLabel && (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {activeTabLabel}
                  </span>
                )}
              </div>
            )}

            {/* Desktop: vertical sidebar */}
            <div
              data-settings-viewport="desktop"
              className="hidden w-52 shrink-0 flex-col overflow-hidden border-r bg-muted/20 p-3 sm:flex lg:w-56"
              style={{ height: `${desktopHeight}px` }}
            >
              <TooltipProvider delayDuration={300}>
                <div
                  className={cn(
                    "min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto",
                    scrollbarClassName,
                  )}
                >
                  {sidebarHeader && <div className="mb-3">{sidebarHeader}</div>}
                  {renderSectionList()}
                </div>
              </TooltipProvider>
              {sidebarFooter && (
                <div className="mt-3 shrink-0 border-t pt-3 space-y-1">{sidebarFooter}</div>
              )}
            </div>

            {/* Content
             *  max-height (not height) is used here so overflow-y-auto activates
             *  regardless of the flex container's own height. Using `height` alone
             *  was insufficient because align-items:stretch on the row flex parent
             *  overrides a child's height when the parent is unconstrained (sm:h-auto
             *  on DialogContent), causing tall tabs like Security to expand the dialog
             *  instead of scrolling within it.
             */}
            <div
              className={cn(
                "min-h-0 min-w-0 flex-1 flex-col sm:flex",
                mobileDetailOpen ? "flex" : "hidden",
              )}
              style={{ maxHeight: `${desktopHeight}px` }}
            >
              {isFullBleed ? (
                <>
                  {/* Full-bleed pages own their scroll/layout, so the breadcrumb
                      sits in a fixed header row above them. Hidden on mobile —
                      the back bar above already shows the current tab. */}
                  {breadcrumb && (
                    <div className="hidden shrink-0 px-4 pt-4 pb-2 sm:block sm:px-5">
                      {breadcrumb}
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                </>
              ) : (
                <div
                  className={cn(
                    "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
                    scrollbarClassName,
                  )}
                >
                  <div className="min-w-0 p-4 sm:px-5 sm:py-5">
                    {/* Breadcrumb eyebrow, sits directly above the page title.
                        Hidden on mobile — the back bar above already shows it. */}
                    {breadcrumb && <div className="mb-4 hidden sm:block">{breadcrumb}</div>}
                    {children}
                  </div>
                </div>
              )}
            </div>
          </div>
        </SettingsDialogActionsContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
