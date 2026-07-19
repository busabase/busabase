"use client";

import type { DragEndEvent, DragMoveEvent } from "@dnd-kit/core";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "kui/sidebar";
import {
  ChevronRight,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { type CSSProperties, memo, type ReactNode, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { SidebarTaskList } from "./SidebarTaskList";
import { mergeSearchIntoHref, SPALink } from "./SPALink";
import type { NavGroup, NavItem, NavItemAction } from "./types";

/** Drop position relative to the row the dragged item was released over. */
export type NavDropPosition = "before" | "after" | "inside";

export interface NavNodeDropParams {
  /** The `id` of the dragged NavItem/sub-item. */
  draggedId: string;
  /** The `id` of the NavItem/sub-item the drag ended on. */
  targetId: string;
  position: NavDropPosition;
}

/**
 * Wraps a sidebar row to make it draggable + a drop target via dnd-kit's
 * `useSortable`. Rendered as its own component (rather than calling the hook
 * inline inside a `.map()`) so the hook is called with a stable identity per
 * row, matching the rules of hooks.
 */
type SortableHandle = ReturnType<typeof useSortable>;

export interface NavRowDragProps {
  setNodeRef: SortableHandle["setNodeRef"];
  attributes: SortableHandle["attributes"];
  listeners: SortableHandle["listeners"];
  style: CSSProperties;
}

function DraggableRow({ id, render }: { id: string; render: (p: NavRowDragProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <>
      {render({
        setNodeRef,
        attributes,
        listeners,
        style: {
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1,
        },
      })}
    </>
  );
}

interface NavKeyItem {
  title: string;
  url: string;
  id?: string;
  onClick?: string;
}

const getNavItemKey = (item: NavKeyItem, index: number, prefix = "item") =>
  [prefix, item.id, item.onClick, item.url, item.title, String(index)]
    .filter((v) => v !== undefined && v !== null && v !== "")
    .join(":");

const isExternalUrl = (url: string) => url.startsWith("http://") || url.startsWith("https://");

interface NavMainProps {
  items: NavGroup[];
  /**
   * Callback when a group's header action button is clicked
   * @param groupLabel - The label of the group whose action was clicked
   */
  onHeaderActionClick?: (groupLabel: string) => void;
  /**
   * Callback when a nav item with an action property is clicked
   * @param action - The action key from the nav item
   */
  onNavItemAction?: (action: string) => void;
  /**
   * Whether the task list is expanded (controlled externally)
   */
  isTaskListExpanded?: boolean;
  /**
   * Callback when task list expand/collapse is toggled
   */
  onTaskListExpandToggle?: () => void;
  /**
   * Called when a drag-and-drop of a nav item/sub-item row ends over another
   * row. Only rows whose NavItem carries an `id` participate in drag-and-drop
   * (rows without one, like static shortcut links, are never draggable/droppable).
   * The consumer is responsible for translating this into whatever "move" op
   * makes sense for its own tree (NavMain has no concept of node types).
   */
  onNodeDrop?: (params: NavNodeDropParams) => void;
  /**
   * Called while dragging to ask whether `draggedId` may be dropped at
   * `position` relative to `targetId` — consulted for EVERY drop band, not
   * just "inside": a "before"/"after" drop reparents the dragged node into
   * the target's own parent, which can be just as cycle-prone as dropping
   * directly inside a descendant folder (e.g. dragging an ancestor folder to
   * sit as a sibling inside one of its own descendants). Return false to
   * show a not-allowed cue and reject the drop. Omit to always allow (the
   * consumer can still reject in `onNodeDrop`).
   */
  isDropAllowed?: (draggedId: string, targetId: string, position: NavDropPosition) => boolean;
  /**
   * Called when a folder row (`item.hasChildren` or `item.items`) transitions
   * to open while it has no loaded `items` yet (`item.hasChildren: true` but
   * `items` empty/undefined) — the signal for a consumer that lazy-loads a
   * folder's children on first expand to kick off that fetch. Never called
   * for a folder that already has `items` loaded, or on every open/close —
   * only the "needs its children" transition.
   */
  onExpand?: (item: NavItem) => void;
}

function NavMainComponent({
  items,
  onHeaderActionClick,
  onNavItemAction,
  isTaskListExpanded,
  onTaskListExpandToggle,
  onNodeDrop,
  isDropAllowed,
  onExpand,
}: NavMainProps) {
  const [location, setLocation] = useLocation();
  const currentSearch = useSearch();
  // A nav url is "active" for the current location on an exact match OR when the
  // location is a descendant route (e.g. a record under a base folder). This keeps
  // the parent folder highlighted and expanded while browsing its child pages.
  const isPathActive = (url?: string) =>
    !!url && (location === url || (url !== "/" && location.startsWith(`${url}/`)));
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // Per-folder manual expand/collapse override (by nav-item key). A folder on the
  // active route is always expanded; this only adds extra opens for other folders.
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});

  // Drag-and-drop: dnd-kit needs a flat registry of every id that can act as a
  // drag source or drop target (every row at every depth), plus whether each
  // is a "folder" row (has `items`) so onDragOver can offer an "inside" drop
  // band only for rows that can actually contain children. Walks the WHOLE
  // recursive tree — a folder nested at any depth is a valid drag source and
  // drop target, not just top-level folders.
  const dragEnabled = Boolean(onNodeDrop);
  const { sortableIds, folderIds } = useMemo(() => {
    const ids: string[] = [];
    const folders = new Set<string>();
    const visit = (list: NavItem[]) => {
      for (const item of list) {
        if (item.id) ids.push(item.id);
        // A `hasChildren`-only folder (not yet expanded/loaded) is still a
        // valid "inside" drop target, same as one with `items` already loaded.
        if (item.items || item.hasChildren) {
          if (item.id) folders.add(item.id);
          if (item.items) visit(item.items);
        }
      }
    };
    if (!dragEnabled) return { sortableIds: ids, folderIds: folders };
    for (const group of items) {
      if (group.isDynamic) continue;
      visit(group.items);
    }
    return { sortableIds: ids, folderIds: folders };
  }, [items, dragEnabled]);

  type DragState = {
    activeId: string;
    overId: string | null;
    position: NavDropPosition | null;
    disallowed: boolean;
  } | null;
  const [dragState, setDragState] = useState<DragState>(null);
  // Mirrors `dragState` synchronously (no re-render lag). `onDragMove` and
  // `onDragEnd` can both fire from the same native pointer-up sequence before
  // React commits the last `setDragState` from `onDragMove` — reading the
  // `dragState` closure in `onDragEnd` in that case returns a STALE value
  // (e.g. the previous tick's "before/after" instead of the "inside" the
  // pointer had actually just reached), silently dropping into the wrong
  // parent right when the user releases over a folder. The ref is always
  // current the instant `onDragMove` runs, regardless of render timing.
  const dragStateRef = useRef<DragState>(null);
  const setDrag = (next: DragState) => {
    dragStateRef.current = next;
    setDragState(next);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // `onDragMove`, not `onDragOver` — dnd-kit only fires onDragOver when the
  // collided droppable id CHANGES, so a before/after read taken there goes
  // stale the instant the pointer keeps moving inside the same target's rect
  // (exactly the common case: dragging slowly toward the top vs. bottom half
  // of a row). onDragMove fires on every pointer tick with a fresh `over` too.
  const handleDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;
    if (!over) {
      setDrag(
        dragStateRef.current ? { ...dragStateRef.current, overId: null, position: null } : null,
      );
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) {
      setDrag({ activeId, overId: null, position: null, disallowed: false });
      return;
    }
    const overRect = over.rect;
    // NOT `active.rect.current.translated` — `verticalListSortingStrategy` already
    // animates the dragged item's translated rect into a "swap preview" position as
    // soon as `over` changes, which corrupts a before/after read taken from it (it
    // reports a rect that has already visually jumped near/past the target, not
    // where the pointer actually is). The `initial` rect + the event's own
    // pointer delta gives the untransformed position, immune to that choreography.
    const initialRect = active.rect.current.initial;
    if (!overRect || !initialRect) {
      setDrag({ activeId, overId, position: "after", disallowed: false });
      return;
    }
    const activeCenterY = initialRect.top + initialRect.height / 2 + event.delta.y;
    const relativeY = (activeCenterY - overRect.top) / overRect.height;
    const overIsFolder = folderIds.has(overId);
    let position: NavDropPosition;
    if (overIsFolder && relativeY > 0.25 && relativeY < 0.75) {
      position = "inside";
    } else if (relativeY <= 0.5) {
      position = "before";
    } else {
      position = "after";
    }
    const disallowed = isDropAllowed ? !isDropAllowed(activeId, overId, position) : false;
    setDrag({ activeId, overId, position, disallowed });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Read the ref, NOT the `dragState` closure — see the comment on
    // `dragStateRef` above for why the closure can be stale here.
    const finalState = dragStateRef.current;
    setDrag(null);
    if (!over || !onNodeDrop) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    const position = finalState?.position ?? "after";
    if (isDropAllowed && !isDropAllowed(activeId, overId, position)) return;
    onNodeDrop({ draggedId: activeId, targetId: overId, position });
  };

  // Visual cue for the row currently under the drag pointer: an accent ring
  // for an "inside" (reparent) drop, or a border for a "before"/"after"
  // (reorder) drop. Uses semantic tokens only (primary/destructive), no
  // hardcoded colors, so the cue always matches theme + dark mode.
  const dropIndicatorClass = (id: string | undefined) => {
    if (!id || !dragState || dragState.overId !== id) return "";
    if (dragState.position === "inside") {
      return dragState.disallowed
        ? "ring-2 ring-destructive/60 bg-destructive/5"
        : "ring-2 ring-primary/50 bg-primary/5";
    }
    // A "before"/"after" drop can be disallowed too — it reparents into the
    // target's own parent, which is just as cycle-prone as an "inside" drop.
    const borderColor = dragState.disallowed ? "border-destructive" : "border-primary";
    if (dragState.position === "before") return `border-t-2 ${borderColor}`;
    if (dragState.position === "after") return `border-b-2 ${borderColor}`;
    return "";
  };

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const handleItemAction = (action: NavItemAction) => {
    if (action.onSelect) {
      action.onSelect();
      return;
    }
    if (action.action) {
      onNavItemAction?.(action.action);
      return;
    }
    if (action.url) {
      if (isExternalUrl(action.url)) {
        window.open(action.url, "_blank", "noopener,noreferrer");
      } else {
        setLocation(mergeSearchIntoHref(action.url, currentSearch));
      }
    }
  };

  // A subtree is "active" if the item itself, or ANY descendant at any depth,
  // matches the current route — used to auto-open every ancestor folder along
  // the path to the active row, regardless of nesting depth.
  const isDescendantActive = (candidate: NavItem): boolean =>
    isPathActive(candidate.url) || (candidate.items?.some(isDescendantActive) ?? false);

  /**
   * Renders a single nav row — folder or leaf — and recurses into `item.items`
   * for any nested children, so a folder gets the exact same chevron/hover
   * actions/drag-handle treatment no matter how deep it's nested. `depth` only
   * changes the wrapping list element (`SidebarMenuItem` at the top level vs.
   * `SidebarMenuSubItem` once nested inside a `SidebarMenuSub`) and, for plain
   * leaves, which existing leaf style to keep (top-level `SidebarMenuButton`
   * row vs. the more compact `SidebarMenuSubButton` row previously reserved
   * for one level of nesting) — every other behavior (active-route highlight,
   * open/collapse override, drag-and-drop) is identical at every depth.
   */
  const renderNavRow = (
    item: NavItem,
    index: number,
    keyPrefix: string,
    depth: number,
    isSiblingActiveMatch = false,
  ): ReactNode => {
    const Icon = item.icon;
    const itemKey = getNavItemKey(item, index, keyPrefix);
    // Label for the per-row "•••" action menu — shared by the folder row and
    // both leaf rows (they all render `item.actions` the same way).
    const moreActionsTitle = item.moreActionsTitle ?? "More";
    // A folder is open when it (or one of its descendants, at any depth) is
    // the active route, or when manually expanded. Selecting a folder thus
    // also expands it, and navigating away collapses it again.
    const isActiveTree =
      Boolean(item.isActive) ||
      isPathActive(item.url) ||
      (item.items?.some((subItem) => isDescendantActive(subItem)) ?? false);
    const isOpen = isActiveTree || (openOverrides[itemKey] ?? false);

    // If item declares sub-items, render as a folder-style row, even when the
    // current folder is empty. `hasChildren` alone (no `items` loaded yet —
    // a lazy-loaded folder that hasn't been expanded/fetched) renders the
    // same expandable folder row, just with an empty/loading body until
    // `onExpand` populates it.
    if (item.items || item.hasChildren) {
      // Captured as a local so it stays narrowed to non-undefined inside
      // `renderFolderRow` below — TS doesn't carry a property narrow
      // (`item.items`) across a nested closure boundary.
      const folderItems = item.items ?? [];
      const canDrag = dragEnabled && Boolean(item.id);
      const hoverActionCount =
        (item.onAddChild ? 1 : 0) + (item.actions?.length ? 1 : 0) + (canDrag ? 1 : 0);
      const hasHoverActions = hoverActionCount > 0;
      const trailingPadding =
        hoverActionCount === 0
          ? "pr-2"
          : hoverActionCount === 1
            ? "pr-[2.5rem]"
            : hoverActionCount === 2
              ? "pr-[4.25rem]"
              : "pr-[6rem]";
      const addChildTitle = item.addChildTitle ?? "New";
      const ItemWrapper = depth === 0 ? SidebarMenuItem : SidebarMenuSubItem;
      const renderFolderRow = (dragProps?: NavRowDragProps) => (
        <Collapsible
          key={itemKey}
          asChild
          open={isOpen}
          onOpenChange={(open) => {
            setOpenOverrides((prev) => ({ ...prev, [itemKey]: open }));
            // Fire the lazy-load signal only on the actual "needs children"
            // transition — a folder that already has `items` loaded (or is
            // being closed) never triggers a refetch.
            if (open && item.hasChildren && !item.items?.length) {
              onExpand?.(item);
            }
          }}
          className="group/collapsible"
        >
          <ItemWrapper>
            <div
              ref={dragProps?.setNodeRef}
              style={dragProps?.style}
              // The sortable ref binds to just this header row, NOT the outer
              // list item — that <li> also wraps the expanded
              // CollapsibleContent subtree, so its rect would span the
              // folder's own children too. Since dnd-kit's closestCenter
              // compares rect centers, a folder's giant rect (header + all
              // expanded children) can out-compete its own children as the
              // "closest" drop target, making it nearly impossible to drop
              // between two rows inside an open folder.
              className={`group/nav-tree-item relative flex h-8 min-w-0 items-center rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                isPathActive(item.url) ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""
              } ${dropIndicatorClass(item.id)}`}
            >
              <CollapsibleTrigger asChild>
                <button
                  // `relative z-10` — at deep nesting the row narrows enough that the
                  // absolutely-positioned hover-actions cluster (below) can render
                  // right on top of this button; an absolutely-positioned sibling
                  // always paints above a static one regardless of DOM order, so
                  // without this the toggle becomes unclickable once a folder is
                  // nested 3+ levels deep.
                  className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[collapsible=icon]:hidden"
                  title="Toggle"
                  type="button"
                >
                  <ChevronRight
                    className={`size-3.5 shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                  <span className="sr-only">Toggle</span>
                </button>
              </CollapsibleTrigger>
              {item.url ? (
                isExternalUrl(item.url) ? (
                  <a
                    className={`flex h-8 min-w-0 flex-1 items-center gap-2 py-1.5 text-sm ${trailingPadding}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.title}
                  >
                    {Icon && <Icon className="size-4 shrink-0" />}
                    <span className="min-w-0 truncate group-data-[collapsible=icon]:hidden">
                      {item.title}
                    </span>
                    <ExternalLink className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
                  </a>
                ) : (
                  <SPALink
                    className={`flex h-8 min-w-0 flex-1 items-center gap-2 py-1.5 text-sm ${trailingPadding}`}
                    href={item.url}
                    title={item.title}
                  >
                    {Icon && <Icon className="size-4 shrink-0" />}
                    <span className="min-w-0 truncate group-data-[collapsible=icon]:hidden">
                      {item.title}
                    </span>
                  </SPALink>
                )
              ) : (
                <CollapsibleTrigger asChild>
                  <button
                    className={`flex h-8 min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm ${trailingPadding}`}
                    title={item.title}
                    type="button"
                  >
                    {Icon && <Icon className="size-4 shrink-0" />}
                    <span className="min-w-0 truncate group-data-[collapsible=icon]:hidden">
                      {item.title}
                    </span>
                  </button>
                </CollapsibleTrigger>
              )}
              {hasHoverActions && (
                <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/nav-tree-item:opacity-100 group-hover/nav-tree-item:opacity-100 group-data-[collapsible=icon]:hidden">
                  {canDrag && (
                    // A dedicated, non-navigational handle carries the drag
                    // listeners — NOT the row's <a>/SPALink. dnd-kit's
                    // PointerSensor calls setPointerCapture on the actual
                    // event.target, so if the listeners were spread onto a
                    // row wrapping a link, the browser fires a spurious click
                    // (navigation) on that link right after the drop.
                    <button
                      className="flex size-7 cursor-grab items-center justify-center rounded-md p-0 text-sidebar-foreground/50 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 active:cursor-grabbing"
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder"
                      type="button"
                      {...(dragProps?.attributes ?? {})}
                      {...(dragProps?.listeners ?? {})}
                    >
                      <GripVertical className="size-3.5 shrink-0" />
                      <span className="sr-only">Drag to reorder</span>
                    </button>
                  )}
                  {item.onAddChild && (
                    <button
                      className="flex size-7 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        item.onAddChild?.();
                      }}
                      title={addChildTitle}
                      type="button"
                    >
                      <Plus className="size-3.5 shrink-0" />
                      <span className="sr-only">{addChildTitle}</span>
                    </button>
                  )}
                  {item.actions && item.actions.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="flex size-7 items-center justify-center rounded-md p-0 text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 data-[state=open]:bg-sidebar-accent data-[state=open]:opacity-100"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          title={moreActionsTitle}
                          type="button"
                        >
                          <MoreHorizontal className="size-3.5 shrink-0" />
                          <span className="sr-only">{moreActionsTitle}</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {item.actions.map((action) => {
                          const ActionIcon = action.icon;
                          return (
                            <DropdownMenuItem
                              key={`${itemKey}:action:${action.title}`}
                              variant={action.variant}
                              onSelect={() => handleItemAction(action)}
                            >
                              {ActionIcon && <ActionIcon className="mr-2 size-3.5" />}
                              {action.title}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>
            <CollapsibleContent>
              {/* Tighter indentation than kui's default (mx-3.5/px-2.5) — this
                  margin+padding compounds with every nested SidebarMenuSub, so
                  a folder nested 3-4 levels deep can eat most of the sidebar's
                  width before any title text renders, truncating even short
                  names ("Purchase Orders" -> "Pu..."). Still keeps the
                  border-l hierarchy cue, just narrower. */}
              <SidebarMenuSub className="mx-2 px-1.5">
                {(() => {
                  // The active sub-item is the longest url that the location
                  // matches exactly or as a descendant route (e.g. a
                  // record/view under a base: /base/foo/rec_...). Longest-match
                  // keeps a single highlight when sibling urls overlap (a base
                  // and an item beneath it).
                  const activeSubUrl = folderItems.reduce<string | null>(
                    (best, s) =>
                      isPathActive(s.url) && (!best || s.url.length > best.length) ? s.url : best,
                    null,
                  );
                  return folderItems.map((subItem, subItemIndex) =>
                    renderNavRow(
                      subItem,
                      subItemIndex,
                      `${itemKey}:sub`,
                      depth + 1,
                      !!subItem.url && subItem.url === activeSubUrl,
                    ),
                  );
                })()}
                {/* Lazy-load placeholder: shown only while a `hasChildren`
                    folder's children are being fetched (never alongside
                    already-loaded `items`, which render above instead). Plain
                    `<div>`, not a `SidebarMenuSubButton` — this row is
                    decorative only, not a real link/action. */}
                {item.isLoadingChildren && folderItems.length === 0 && (
                  <SidebarMenuSubItem className="pointer-events-none">
                    <div className="flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2">
                      <span className="h-3.5 w-2/3 animate-pulse rounded bg-sidebar-foreground/10" />
                    </div>
                  </SidebarMenuSubItem>
                )}
              </SidebarMenuSub>
            </CollapsibleContent>
          </ItemWrapper>
        </Collapsible>
      );
      return dragEnabled && item.id ? (
        <DraggableRow key={itemKey} id={item.id} render={renderFolderRow} />
      ) : (
        renderFolderRow()
      );
    }

    // Plain leaf row (no sub-items). The top level keeps the richer
    // SidebarMenuButton-based row (badge, delete action); any nested depth
    // keeps the more compact SidebarMenuSubButton row — same as before this
    // became recursive, just now available at every depth, not only depth 1.
    if (depth === 0) {
      const renderLeafRow = (dragProps?: NavRowDragProps) => (
        <SidebarMenuItem
          key={itemKey}
          ref={dragProps?.setNodeRef}
          style={dragProps?.style}
          className={dropIndicatorClass(item.id)}
        >
          {item.onClick ? (
            // Items with onClick trigger a callback instead of navigation
            <SidebarMenuButton
              tooltip={item.title}
              onClick={() => item.onClick && onNavItemAction?.(item.onClick)}
            >
              {Icon && <Icon />}
              <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
            </SidebarMenuButton>
          ) : (
            // Regular navigation items
            <SidebarMenuButton
              asChild
              tooltip={item.title}
              isActive={
                location === item.url || (item.url !== "/" && location.startsWith(`${item.url}/`))
              }
              className="hover:bg-accent data-[active=true]:bg-accent"
            >
              {isExternalUrl(item.url) ? (
                // External link - use regular anchor tag
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {Icon && <Icon />}
                  <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                  <ExternalLink className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
                </a>
              ) : (
                // Internal link - use SPA Link
                <SPALink href={item.url as any}>
                  {Icon && <Icon />}
                  <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                </SPALink>
              )}
            </SidebarMenuButton>
          )}
          {item.badge !== undefined && item.badge !== null && (
            <SidebarMenuBadge className="bg-primary/10 text-primary ring-1 ring-primary/20 group-data-[collapsible=icon]:hidden">
              {item.badge}
            </SidebarMenuBadge>
          )}
          {/* Generic per-row action menu (e.g. Permissions) — additive: only
              renders when a caller supplies `actions`, so existing leaf rows
              are unchanged. Sits left of the drag handle. A leaf using both
              `onDelete` and `actions` alongside drag isn't a current pattern;
              revisit the right-offsets if that combination ever appears. */}
          {item.actions && item.actions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  showOnHover
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  title={moreActionsTitle}
                  className={`group-data-[collapsible=icon]:hidden data-[state=open]:bg-sidebar-accent data-[state=open]:opacity-100 ${
                    dragEnabled && item.id ? "right-7" : ""
                  }`}
                >
                  <MoreHorizontal />
                  <span className="sr-only">{moreActionsTitle}</span>
                </SidebarMenuAction>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {item.actions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <DropdownMenuItem
                      key={`${itemKey}:action:${action.title}`}
                      variant={action.variant}
                      onSelect={() => handleItemAction(action)}
                    >
                      {ActionIcon && <ActionIcon className="mr-2 size-3.5" />}
                      {action.title}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {item.onDelete && item.id && (
            <SidebarMenuAction
              showOnHover
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (item.id) {
                  item.onDelete?.(item.id);
                }
              }}
              title="Delete"
              className={`group-data-[collapsible=icon]:hidden ${
                dragEnabled && item.id ? "right-7" : ""
              }`}
            >
              <Trash2 />
            </SidebarMenuAction>
          )}
          {dragEnabled && item.id && (
            // See the folder-row comment above: the handle, not the row/link,
            // must own the drag listeners.
            <SidebarMenuAction
              showOnHover
              onClick={(e) => e.stopPropagation()}
              title="Drag to reorder"
              type="button"
              className="cursor-grab active:cursor-grabbing group-data-[collapsible=icon]:hidden"
              {...(dragProps?.attributes ?? {})}
              {...(dragProps?.listeners ?? {})}
            >
              <GripVertical />
            </SidebarMenuAction>
          )}
        </SidebarMenuItem>
      );
      return dragEnabled && item.id ? (
        <DraggableRow key={itemKey} id={item.id} render={renderLeafRow} />
      ) : (
        renderLeafRow()
      );
    }

    const isSubItemActive = isSiblingActiveMatch;
    const SubIcon = item.icon;
    const hasSubActions = !!(item.actions && item.actions.length > 0);
    const renderSubItemRow = (dragProps?: NavRowDragProps) => (
      <SidebarMenuSubItem
        key={itemKey}
        ref={dragProps?.setNodeRef}
        style={dragProps?.style}
        className={`group/subitem relative ${dropIndicatorClass(item.id)}`}
      >
        <SidebarMenuSubButton
          asChild
          isActive={isSubItemActive}
          className={
            // Reserve trailing room for whichever hover controls exist: one
            // slot (pr-7) for drag OR the actions menu, two (pr-14) for both.
            hasSubActions && dragEnabled && item.id
              ? "pr-14"
              : hasSubActions || (dragEnabled && item.id)
                ? "pr-7"
                : undefined
          }
        >
          {isExternalUrl(item.url) ? (
            // External link - use regular anchor tag
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              {SubIcon && <SubIcon />}
              <span>{item.title}</span>
              <ExternalLink className="ml-auto h-4 w-4" />
            </a>
          ) : (
            // Internal link - use SPA Link
            <SPALink href={item.url}>
              {SubIcon && <SubIcon />}
              <span>{item.title}</span>
            </SPALink>
          )}
        </SidebarMenuSubButton>
        {/* Generic per-row action menu (e.g. Permissions) for a nested leaf.
            Additive: only when a caller supplies `actions`. Sits left of the
            drag handle when both are present. */}
        {hasSubActions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`absolute top-1/2 hidden size-5 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground/60 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 group-hover/subitem:flex data-[state=open]:flex data-[state=open]:bg-sidebar-accent ${
                  dragEnabled && item.id ? "right-7" : "right-1"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                title={moreActionsTitle}
                type="button"
              >
                <MoreHorizontal className="size-3 shrink-0" />
                <span className="sr-only">{moreActionsTitle}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(item.actions ?? []).map((action) => {
                const ActionIcon = action.icon;
                return (
                  <DropdownMenuItem
                    key={`${itemKey}:action:${action.title}`}
                    variant={action.variant}
                    onSelect={() => handleItemAction(action)}
                  >
                    {ActionIcon && <ActionIcon className="mr-2 size-3.5" />}
                    {action.title}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {dragEnabled && item.id && (
          // See the folder-row comment above: the handle, not the row/link,
          // must own the drag listeners.
          <button
            className="absolute right-1 top-1/2 hidden size-5 -translate-y-1/2 cursor-grab items-center justify-center rounded-md p-0 text-sidebar-foreground/50 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 active:cursor-grabbing group-hover/subitem:flex"
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            type="button"
            {...(dragProps?.attributes ?? {})}
            {...(dragProps?.listeners ?? {})}
          >
            <GripVertical className="size-3 shrink-0" />
            <span className="sr-only">Drag to reorder</span>
          </button>
        )}
      </SidebarMenuSubItem>
    );
    return dragEnabled && item.id ? (
      <DraggableRow key={itemKey} id={item.id} render={renderSubItemRow} />
    ) : (
      renderSubItemRow()
    );
  };

  // Check if any dynamic group exists (for flex layout)
  const hasDynamicGroup = items.some((group) => group.isDynamic);

  const content = (
    <div className={hasDynamicGroup ? "flex flex-col flex-1 min-h-0 gap-1" : "contents"}>
      {items.map((group, groupIndex) => {
        const HeaderActionIcon = group.headerAction;
        const GroupIcon = group.icon;
        const groupKey = group.label || `group-${groupIndex}`;
        const isCollapsed = collapsedGroups[groupKey] ?? false;

        // For dynamic groups (task lists), use external expand state if provided
        const effectiveIsExpanded = group.isDynamic
          ? (isTaskListExpanded ?? group.isExpanded ?? false)
          : false;
        const effectiveOnExpandToggle = group.isDynamic
          ? (onTaskListExpandToggle ?? group.onExpandToggle)
          : undefined;

        return (
          <SidebarGroup
            key={groupKey}
            className={`${group.className ?? ""} ${group.isDynamic ? "flex-1 min-h-0 flex flex-col" : ""} relative`}
          >
            {group.label && (
              <div className="flex items-center shrink-0 px-2">
                {group.isDynamic ? (
                  <button
                    type="button"
                    onClick={() => toggleGroupCollapse(groupKey)}
                    className="inline-flex items-center gap-1.5 py-1 rounded-md hover:bg-sidebar-accent transition-colors cursor-pointer"
                    title={isCollapsed ? "Expand" : "Collapse"}
                  >
                    {GroupIcon && <GroupIcon className="size-3 text-sidebar-foreground/50" />}
                    <span className="text-[11px] uppercase tracking-wider font-medium text-sidebar-foreground/50">
                      {group.label}
                    </span>
                    <ChevronRight
                      className={`size-3 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}
                    />
                  </button>
                ) : (
                  <SidebarGroupLabel className="flex-1 flex items-center gap-1.5 text-sidebar-foreground/50 text-[11px] uppercase tracking-wider font-medium h-6">
                    {GroupIcon && <GroupIcon className="size-3" />}
                    <span>{group.label}</span>
                  </SidebarGroupLabel>
                )}
              </div>
            )}
            {HeaderActionIcon && (
              <SidebarGroupAction
                title={group.headerActionTitle}
                onClick={() => onHeaderActionClick?.(group.label)}
                className="top-2"
              >
                <HeaderActionIcon className="size-4" />
                {group.headerActionTitle && (
                  <span className="sr-only">{group.headerActionTitle}</span>
                )}
              </SidebarGroupAction>
            )}
            {group.isDynamic ? (
              !isCollapsed && (
                <div className="flex-1 min-h-0 flex flex-col">
                  <SidebarTaskList
                    tasks={group.items}
                    // SPALink signature doesn't exactly match, but is safe for our usage
                    LinkComponent={SPALink as any}
                    variant={group.taskListVariant ?? "dashboard"}
                    isExpanded={effectiveIsExpanded}
                    onExpandToggle={effectiveOnExpandToggle}
                    totalCount={group.totalCount}
                    defaultVisibleCount={group.defaultVisibleCount}
                  />
                </div>
              )
            ) : (
              <SidebarMenu>
                {group.items.map((item, itemIndex) => renderNavRow(item, itemIndex, "item", 0))}
              </SidebarMenu>
            )}
          </SidebarGroup>
        );
      })}
    </div>
  );

  if (!dragEnabled) return content;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {content}
      </SortableContext>
    </DndContext>
  );
}

// Memoize component with custom comparison to prevent unnecessary re-renders
export const NavMain = memo(NavMainComponent, (prevProps, nextProps) => {
  // Compare items array length
  if (prevProps.items.length !== nextProps.items.length) {
    return false;
  }

  // Compare each item's key properties (shallow comparison)
  for (let i = 0; i < prevProps.items.length; i++) {
    const prevGroup = prevProps.items[i];
    const nextGroup = nextProps.items[i];

    if (prevGroup.label !== nextGroup.label || prevGroup.items.length !== nextGroup.items.length) {
      return false;
    }

    if (prevGroup.taskListVariant !== nextGroup.taskListVariant) {
      return false;
    }

    if (prevGroup.isExpanded !== nextGroup.isExpanded) {
      return false;
    }

    if (prevGroup.totalCount !== nextGroup.totalCount) {
      return false;
    }

    if (prevGroup.defaultVisibleCount !== nextGroup.defaultVisibleCount) {
      return false;
    }

    // Compare items within each group
    for (let j = 0; j < prevGroup.items.length; j++) {
      const prevItem = prevGroup.items[j];
      const nextItem = nextGroup.items[j];

      if (
        prevItem.url !== nextItem.url ||
        prevItem.title !== nextItem.title ||
        prevItem.badge !== nextItem.badge ||
        prevItem.status !== nextItem.status ||
        prevItem.spaceName !== nextItem.spaceName ||
        prevItem.createdAt !== nextItem.createdAt ||
        prevItem.onAddChild !== nextItem.onAddChild ||
        prevItem.addChildTitle !== nextItem.addChildTitle ||
        prevItem.moreActionsTitle !== nextItem.moreActionsTitle ||
        prevItem.hasChildren !== nextItem.hasChildren ||
        prevItem.isLoadingChildren !== nextItem.isLoadingChildren ||
        (prevItem.items?.length ?? 0) !== (nextItem.items?.length ?? 0) ||
        (prevItem.actions?.length ?? 0) !== (nextItem.actions?.length ?? 0)
      ) {
        return false;
      }

      for (let k = 0; k < (prevItem.actions?.length ?? 0); k++) {
        const prevAction = prevItem.actions?.[k];
        const nextAction = nextItem.actions?.[k];
        if (
          prevAction?.title !== nextAction?.title ||
          prevAction?.action !== nextAction?.action ||
          prevAction?.url !== nextAction?.url ||
          prevAction?.variant !== nextAction?.variant ||
          prevAction?.onSelect !== nextAction?.onSelect
        ) {
          return false;
        }
      }
    }
  }

  // Compare callback function references
  if (prevProps.onHeaderActionClick !== nextProps.onHeaderActionClick) {
    return false;
  }

  if (prevProps.onNavItemAction !== nextProps.onNavItemAction) {
    return false;
  }

  if (prevProps.isTaskListExpanded !== nextProps.isTaskListExpanded) {
    return false;
  }

  if (prevProps.onTaskListExpandToggle !== nextProps.onTaskListExpandToggle) {
    return false;
  }

  return true;
});
