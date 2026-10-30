import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "kui/breadcrumb";
import { SidebarTrigger } from "kui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { Info } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { Fragment, type ReactNode, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { BusabaseBreadcrumbItem } from "../helpers/view-types";
import { useNodeLocator } from "../hooks/use-copy-locator";
import { useTopbarNodeActionsStore } from "../store/topbar-node-actions-store";
import { useTopbarNodeInfoStore } from "../store/topbar-node-info-store";
import { useIsAnonymousVisitor } from "../visitor-context";
import { CopyLocatorIconButton } from "./copy-locator-button";
import { NodeSettingsDialog } from "./node-settings-dialog";

/**
 * The workbench topbar row: sidebar toggle, breadcrumb, then whatever the
 * caller appends. The member workbench appends its node actions; a host that
 * wraps a chromeless dashboard in its own sidebar (Cloud's public shared
 * folder) renders it bare, so both get the same toggle and the same trail.
 * Needs a `SidebarProvider` above it, as `SidebarTrigger` does.
 */
export function BusabaseTopbar({
  items,
  showNodeInfo,
  children,
}: {
  items: BusabaseBreadcrumbItem[];
  showNodeInfo?: boolean;
  children?: ReactNode;
}) {
  const messages = useCoreI18n();
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-4 py-1.5 backdrop-blur-sm md:h-12"
      data-dashboard-topbar
    >
      <SidebarTrigger
        aria-label={messages.shell.toggleSidebar}
        className="h-8 w-8 shrink-0"
        title={messages.shell.toggleSidebar}
      />
      <BusabaseTopbarBreadcrumb items={items} showNodeInfo={showNodeInfo} />
      {children}
    </div>
  );
}

export function BusabaseTopbarBreadcrumb({
  items,
  showNodeInfo = true,
}: {
  items: BusabaseBreadcrumbItem[];
  /** Mirrors the guard the topbar puts on `TopbarNodeActionsSlot`: hidden while
   *  the current node route is anything but active, so a still-mounted view
   *  cannot flash its Info button over an archived/unavailable route. */
  showNodeInfo?: boolean;
}) {
  const messages = useCoreI18n();
  const visibleItems = items.length > 0 ? items : [{ label: messages.inbox.title }];
  // Which crumb names the node? A Base's view/record/design routes append the
  // view name, the record title or "Design" AFTER it, so "the last crumb" is
  // the wrong answer there — the Info button would sit against "Ready to
  // publish" while opening the settings of "Posts". Routes with no node at all
  // (Inbox, Agents, …) mark nothing, and fall back to the last crumb so their
  // topbar is unchanged.
  const markedNodeIndex = visibleItems.findIndex((item) => item.isNode);
  const nodeIndex = markedNodeIndex === -1 ? visibleItems.length - 1 : markedNodeIndex;

  return (
    <Breadcrumb aria-label={messages.shell.breadcrumb} className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap gap-1.5 overflow-hidden text-xs sm:gap-2">
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;
          const hideOnMobile = visibleItems.length > 2 && index > 0 && !isLast;
          // The node crumb carries the page's visual focus now that node-detail
          // views no longer render a big in-page title: one step up in size,
          // semibold, full-contrast. Every other crumb stays the small muted
          // path it always was.
          const isNodeCrumb = index === nodeIndex;
          const emphasis = isNodeCrumb
            ? "font-semibold text-foreground text-sm"
            : "font-normal text-muted-foreground";

          return (
            <Fragment key={`${item.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator
                  className={`shrink-0 text-muted-foreground/70 ${
                    hideOnMobile ? "hidden sm:inline-flex" : ""
                  }`}
                />
              ) : null}
              <BreadcrumbItem
                className={`min-w-0 ${isNodeCrumb ? "group/node-crumb" : ""} ${hideOnMobile ? "hidden sm:inline-flex" : ""}`}
              >
                {item.href && !isLast ? (
                  <BreadcrumbLink asChild className={`min-w-0 truncate ${emphasis}`}>
                    <Link
                      href={item.href}
                      /* Stable hook for "which node am I on": this text used to
                         be an in-page <h1> that the e2e suite asserted on. */
                      data-topbar-current-item={isNodeCrumb ? "" : undefined}
                    >
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage
                    className={`min-w-0 truncate ${isNodeCrumb ? emphasis : "font-normal text-foreground"}`}
                    data-topbar-current-item={isNodeCrumb ? "" : undefined}
                  >
                    {item.label}
                  </BreadcrumbPage>
                )}
                {/* Inside the node's own BreadcrumbItem on purpose: the
                    Breadcrumb itself is `min-w-0 flex-1`, so anything rendered
                    as its sibling in the topbar row would be pushed to the far
                    right instead of sitting against the node's name. */}
                {isNodeCrumb && showNodeInfo ? <TopbarNodeInfoButton /> : null}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * The one Info affordance for every node type: hover for the node's
 * description, click for the node settings dialog on its Info tab. Reads
 * whatever the visible node-detail view registered via
 * `useRegisterTopbarNodeInfo`, so the views themselves carry no title/
 * description/dialog markup at all.
 *
 * The dialog stays mounted (rather than being conditionally rendered) so a
 * re-registration while it is open cannot tear it down mid-interaction; it
 * only fetches once `open` is true.
 */
export function TopbarNodeInfoButton() {
  const messages = useCoreI18n();
  const info = useTopbarNodeInfoStore((state) => state.info);
  const [open, setOpen] = useState(false);

  if (!info) {
    return null;
  }

  const description = info.description?.trim();

  return (
    <>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={messages.nodeDetail.details}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(true)}
              type="button"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          {/* Descriptions can be long: cap the width and let them wrap rather
              than stretching the tooltip across the viewport. */}
          <TooltipContent className="max-w-xs whitespace-pre-line wrap-break-word" side="bottom">
            {description || messages.nodeDetail.details}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TopbarNodeLocatorButton
        nodeId={info.nodeId}
        nodeName={info.nodeName}
        nodeType={info.nodeType}
      />
      <NodeSettingsDialog
        initialTab="info"
        nodeId={info.nodeId}
        nodeName={info.nodeName}
        nodeSlug={info.nodeSlug}
        nodeType={info.nodeType}
        onOpenChange={setOpen}
        open={open}
        orpc={info.orpc}
      />
    </>
  );
}

/**
 * Copy this node's locator (target line + connection check) for an agent —
 * Notion's "copy link" icon, but producing something an agent can act on.
 * Revealed with the Info marker's row on hover/focus so the resting topbar is
 * unchanged; always shown where there is no hover (touch).
 */
function TopbarNodeLocatorButton({
  nodeId,
  nodeName,
  nodeType,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
}) {
  const isAnon = useIsAnonymousVisitor();
  const locator = useNodeLocator({ nodeId, nodeName, nodeType });
  if (isAnon) return null;
  return (
    <CopyLocatorIconButton
      className="opacity-0 focus-visible:opacity-100 group-focus-within/node-crumb:opacity-100 group-hover/node-crumb:opacity-100 [@media(hover:none)]:opacity-100"
      locator={locator}
    />
  );
}

/**
 * Renders whatever node-detail action cluster (Edit-if-Doc + Pin + "..."
 * menu) the currently visible node-detail view registered via
 * `useRegisterTopbarNodeActions`. Kept as its own component (rather than
 * reading the store directly in `dashboard/index.tsx`) so a registration
 * change only re-renders this small slot, not the whole dashboard shell.
 *
 * Deliberately separate from the older, unrelated `topbarActions` slot next
 * to it in `index.tsx` (`RecordTopbarActions` / `BaseTopbarActions`, a
 * page-level tab switcher) — this one is additive, for the per-node action
 * cluster only.
 */
export function TopbarNodeActionsSlot() {
  const actions = useTopbarNodeActionsStore((state) => state.actions);
  if (!actions) {
    return null;
  }
  return <div className="flex shrink-0 items-center gap-1.5">{actions}</div>;
}
