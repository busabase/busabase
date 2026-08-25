"use client";

import type { CollisionDetection, DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
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
import {
  type CSSProperties,
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useSearch } from "wouter";
import { SidebarTaskList } from "./SidebarTaskList";
import { mergeSearchIntoHref, SPALink } from "./SPALink";
import { resolveTreeDrop, type TreeDropRow, type TreeDropTarget } from "./tree-drop";
import type { NavGroup, NavItem, NavItemAction } from "./types";

export type { NavDropPosition } from "./tree-drop";

import type { NavDropPosition } from "./tree-drop";

export interface NavNodeDropParams {
  /** The `id` of the dragged NavItem/sub-item. */
  draggedId: string;
  /** The `id` of the NavItem/sub-item the drag ended on. */
  targetId: string;
  position: NavDropPosition;
}

/**
 * Wraps a sidebar row to make it BOTH a drag source and a drop target.
 *
 * Deliberately `useDraggable` + `useDroppable`, NOT `useSortable`: a sortable
 * row belongs to a one-dimensional `SortableContext` whose strategy translates
 * every row mid-drag to preview a flat-list reorder. On a tree that preview is
 * meaningless (rows jump around) and actively harmful — the shifted rects fed
 * the drop-position maths, so reordering two children inside a folder resolved
 * against the folder's own header and moved the node out to the root. See
 * `tree-drop.ts` for the measurements. Plain draggable/droppable rows never
 * move, so their rects stay in the same coordinate space as the pointer.
 *
 * Rendered as its own component (rather than calling the hooks inline inside a
 * `.map()`) so they are called with a stable identity per row, matching the
 * rules of hooks.
 */
export interface NavRowDragProps {
  setNodeRef: (element: HTMLElement | null) => void;
  attributes: ReturnType<typeof useDraggable>["attributes"];
  listeners: ReturnType<typeof useDraggable>["listeners"];
  style: CSSProperties;
}

function DraggableRow({
  id,
  depth,
  isContainer,
  render,
}: {
  id: string;
  depth: number;
  isContainer: boolean;
  render: (p: NavRowDragProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id });
  // `depth`/`isContainer` ride along on the droppable so collision detection can
  // read them straight off the container it is already iterating, instead of
  // closing over a separate lookup table that could drift out of sync.
  const { setNodeRef: setDropRef } = useDroppable({ id, data: { depth, isContainer } });
  // One DOM node, two dnd-kit registrations — the row is its own drop target.
  const setNodeRef = useCallback(
    (element: HTMLElement | null) => {
      setDragRef(element);
      setDropRef(element);
    },
    [setDragRef, setDropRef],
  );
  return (
    <>
      {render({
        setNodeRef,
        attributes,
        listeners,
        // No transform/transition: the row stays exactly where it is for the
        // whole drag. The only feedback is this dimming plus the drop indicator
        // drawn on the target row (and the DragOverlay following the cursor).
        style: { opacity: isDragging ? 0.4 : 1 },
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

/**
 * The ONE button footprint for every hover-revealed row control, at every depth.
 *
 * `size-5` + a `size-4` icon deliberately matches kui's own `SidebarMenuAction`
 * (`w-5`, `[&>svg]:size-4`) rather than inventing a fourth size: leaf rows across
 * every app already render at those metrics, so folder rows converge onto the
 * existing design-system standard instead of everything converging onto a new one.
 */
const NAV_ROW_ACTION_BUTTON =
  "flex size-5 shrink-0 items-center justify-center rounded-md p-0 outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0";

/**
 * Keeps the cluster visible while its "•••" dropdown is open — without this the
 * menu closes the moment the pointer leaves the row to travel to the menu.
 */
const NAV_ROW_ACTIONS_OPEN_CLASS = "has-[[data-state=open]]:opacity-100";

/**
 * Trailing room a row's title must leave for its hover cluster, indexed by how
 * many controls that row renders.
 *
 * Derived rather than guessed: the cluster sits at `right-1` (4px) and packs N
 * `size-5` (20px) buttons with `gap-0.5` (2px), so it occupies 4 + 20N + 2(N−1)
 * px — 24, 46, 68, 90 for N = 1..4. Each entry is the next Tailwind spacing step
 * at or above that. Folder rows previously reserved a flat 96px for what is
 * really 68px of controls, which is why long names ("Personal Knowledge")
 * truncated on a 255px sidebar while ~28px of the row sat empty.
 */
const NAV_ROW_TRAILING_PADDING = ["pr-2", "pr-7", "pr-12", "pr-[4.5rem]", "pr-24"] as const;

const navRowTrailingPadding = (actionCount: number) =>
  NAV_ROW_TRAILING_PADDING[Math.min(actionCount, NAV_ROW_TRAILING_PADDING.length - 1)];

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

  const dragEnabled = Boolean(onNodeDrop);
  // Titles of every draggable row, for the `DragOverlay` chip that follows the
  // cursor. Only groups that opted into drag are walked — see `NavGroup.draggable`
  // for why a group must opt in rather than every non-dynamic group being swept
  // in: Favorites renders the SAME node ids as the tree, and two DOM rows
  // registering one dnd-kit id made the drop indicator light up on both at once.
  const dragRowTitles = useMemo(() => {
    const titles = new Map<string, string>();
    if (!dragEnabled) return titles;
    const visit = (list: NavItem[]) => {
      for (const item of list) {
        if (item.id) titles.set(item.id, item.title);
        if (item.items) visit(item.items);
      }
    };
    for (const group of items) {
      if (group.isDynamic || !group.draggable) continue;
      visit(group.items);
    }
    return titles;
  }, [items, dragEnabled]);

  type DragState = {
    activeId: string;
    overId: string | null;
    position: NavDropPosition | null;
    disallowed: boolean;
  } | null;
  const [dragState, setDragState] = useState<DragState>(null);
  // Mirrors `dragState` synchronously (no re-render lag). `onDragEnd` can fire
  // from the same native pointer-up sequence before React commits the last
  // `setDragState`, so reading the `dragState` closure there can return a STALE
  // value. The ref is always current.
  const dragStateRef = useRef<DragState>(null);
  const setDrag = (next: DragState) => {
    dragStateRef.current = next;
    setDragState(next);
  };
  // The drop resolved by `collisionDetection` below on the most recent pointer
  // tick. Both the visual indicator and the committed move read THIS — which is
  // what makes it structurally impossible for the two to disagree. They used to
  // be computed separately (indicator from our own before/after maths, commit
  // from dnd-kit's `over`), and mid-drag they genuinely diverged: the indicator
  // line drew on the sibling row while the request that fired named the parent
  // folder.
  const resolvedDropRef = useRef<TreeDropTarget | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /**
   * Collision detection AND drop-position resolution in one pass, delegated to
   * the pure `resolveTreeDrop` (see `tree-drop.ts`).
   *
   * Not `closestCenter`: nearest-center snaps the drop onto whatever row happens
   * to be closest even when the pointer is nowhere near it, which on a tree
   * means a parent folder header repeatedly winning over the sibling row the
   * user is pointing at. This is strictly "the row the pointer is actually
   * inside, deepest first" — outside every row resolves to no target at all.
   */
  const collisionDetection: CollisionDetection = useCallback(
    ({ active, droppableContainers, droppableRects, pointerCoordinates }) => {
      if (!pointerCoordinates) {
        resolvedDropRef.current = null;
        return [];
      }
      const activeId = String(active.id);
      const rows: TreeDropRow[] = [];
      for (const container of droppableContainers) {
        const id = String(container.id);
        // A row is never its own drop target.
        if (id === activeId) continue;
        const rect = droppableRects.get(container.id);
        if (!rect) continue;
        const data = container.data.current as
          | { depth?: number; isContainer?: boolean }
          | undefined;
        rows.push({
          id,
          top: rect.top,
          height: rect.height,
          isContainer: Boolean(data?.isContainer),
          depth: data?.depth ?? 0,
        });
      }
      const resolved = resolveTreeDrop(rows, pointerCoordinates.y);
      resolvedDropRef.current = resolved;
      if (!resolved) return [];
      const winner = droppableContainers.find(
        (container) => String(container.id) === resolved.targetId,
      );
      return winner ? [{ id: winner.id }] : [];
    },
    [],
  );

  // Fires on every pointer tick. It only mirrors what `collisionDetection`
  // already resolved into React state so the indicator can render — all the
  // geometry lives in the pure function, none of it here.
  const handleDragMove = () => {
    const previous = dragStateRef.current;
    if (!previous) return;
    const resolved = resolvedDropRef.current;
    if (!resolved) {
      if (previous.overId === null) return;
      setDrag({ ...previous, overId: null, position: null, disallowed: false });
      return;
    }
    const disallowed = isDropAllowed
      ? !isDropAllowed(previous.activeId, resolved.targetId, resolved.position)
      : false;
    if (
      previous.overId === resolved.targetId &&
      previous.position === resolved.position &&
      previous.disallowed === disallowed
    ) {
      return;
    }
    setDrag({
      activeId: previous.activeId,
      overId: resolved.targetId,
      position: resolved.position,
      disallowed,
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    resolvedDropRef.current = null;
    setDrag({ activeId: String(event.active.id), overId: null, position: null, disallowed: false });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const resolved = resolvedDropRef.current;
    resolvedDropRef.current = null;
    setDrag(null);
    if (!onNodeDrop || !resolved) return;
    const activeId = String(event.active.id);
    if (activeId === resolved.targetId) return;
    if (isDropAllowed && !isDropAllowed(activeId, resolved.targetId, resolved.position)) return;
    onNodeDrop({
      draggedId: activeId,
      targetId: resolved.targetId,
      position: resolved.position,
    });
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

  /**
   * The body of a row's "•••" dropdown. Extracted because three separate rows
   * (group header, folder, leaf) render the identical action list — keeping it
   * in one place is what lets a change like `separatorBefore` land once instead
   * of three times, each an opportunity to miss one.
   */
  const renderActionItems = (actions: NavItemAction[], itemKey: string) =>
    actions.map((action, index) => (
      <Fragment key={`${itemKey}:action:${action.title}`}>
        {/* A separator above the first item would render as a stray leading
            rule, so the flag only takes effect from the second item on. */}
        {action.separatorBefore && index > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => handleItemAction(action)} variant={action.variant}>
          {action.icon && <action.icon className="mr-2 size-3.5" />}
          {action.title}
        </DropdownMenuItem>
      </Fragment>
    ));

  /**
   * Every hover-revealed row control — drag grip, "+", delete, "•••" — at every
   * depth, in one place.
   *
   * These used to be three independent implementations (folder header, top-level
   * leaf, nested leaf) that had drifted apart on every axis at once. Measured on
   * a 255px sidebar: the "•••" button was 28px on a folder row and 20px on a
   * Base row, its icon 14px vs 12px, its right edge landed at x=243 vs x=206,
   * and the grip sat LEFTMOST on folder rows but RIGHTMOST on leaf rows — so the
   * same two controls swapped places depending which row you hovered. The old
   * `right-7`/`right-1` offsets also meant every new control needed another
   * hand-computed offset in three files' worth of places.
   *
   * One flex cluster, one button size, one order (grip → add → delete → more,
   * "more" always last), anchored `right-1` for every row type. Flex handles the
   * spacing, so adding a control never needs another magic offset again.
   */
  const renderRowActions = ({
    itemKey,
    item,
    canDrag,
    dragProps,
    moreActionsTitle,
  }: {
    itemKey: string;
    item: NavItem;
    canDrag: boolean;
    dragProps?: NavRowDragProps;
    moreActionsTitle: string;
  }) => (
    <div
      className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/nav-row:opacity-100 group-hover/nav-row:opacity-100 group-data-[collapsible=icon]:hidden ${NAV_ROW_ACTIONS_OPEN_CLASS}`}
    >
      {canDrag && (
        // A dedicated, non-navigational handle carries the drag listeners —
        // NOT the row's <a>/SPALink. dnd-kit's PointerSensor calls
        // setPointerCapture on the actual event.target, so if the listeners
        // were spread onto a row wrapping a link, the browser fires a spurious
        // click (navigation) on that link right after the drop.
        <button
          className={`${NAV_ROW_ACTION_BUTTON} cursor-grab text-sidebar-foreground/50 active:cursor-grabbing`}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
          type="button"
          {...(dragProps?.attributes ?? {})}
          {...(dragProps?.listeners ?? {})}
        >
          <GripVertical />
          <span className="sr-only">Drag to reorder</span>
        </button>
      )}
      {item.onAddChild && (
        <button
          className={`${NAV_ROW_ACTION_BUTTON} text-sidebar-foreground/70`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            item.onAddChild?.();
          }}
          title={item.addChildTitle ?? "New"}
          type="button"
        >
          <Plus />
          <span className="sr-only">{item.addChildTitle ?? "New"}</span>
        </button>
      )}
      {item.onDelete && item.id && (
        <button
          className={`${NAV_ROW_ACTION_BUTTON} text-sidebar-foreground/70`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (item.id) item.onDelete?.(item.id);
          }}
          title="Delete"
          type="button"
        >
          <Trash2 />
          <span className="sr-only">Delete</span>
        </button>
      )}
      {item.actions && item.actions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={`${NAV_ROW_ACTION_BUTTON} text-sidebar-foreground/70 data-[state=open]:bg-sidebar-accent`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              title={moreActionsTitle}
              type="button"
            >
              <MoreHorizontal />
              <span className="sr-only">{moreActionsTitle}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {renderActionItems(item.actions, itemKey)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  /** How many hover controls a row will render — drives its trailing padding. */
  const countRowActions = (item: NavItem, canDrag: boolean) =>
    (canDrag ? 1 : 0) +
    (item.onAddChild ? 1 : 0) +
    (item.onDelete && item.id ? 1 : 0) +
    (item.actions?.length ? 1 : 0);

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
    /**
     * Whether the GROUP this row belongs to opted into drag-and-drop
     * (`NavGroup.draggable`). Threaded down the recursion rather than read from
     * a closure so a nested row can never disagree with its own group.
     */
    groupDraggable = false,
  ): ReactNode => {
    const rowDragEnabled = dragEnabled && groupDraggable;
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
      const canDrag = rowDragEnabled && Boolean(item.id);
      const hoverActionCount = countRowActions(item, canDrag);
      const hasHoverActions = hoverActionCount > 0;
      const trailingPadding = navRowTrailingPadding(hoverActionCount);
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
              className={`group/nav-row relative flex h-8 min-w-0 items-center rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
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
              {hasHoverActions &&
                renderRowActions({ itemKey, item, canDrag, dragProps, moreActionsTitle })}
            </div>
            <CollapsibleContent>
              {/* Tighter indentation than kui's default (mx-3.5/px-2.5) — this
                  margin+padding compounds with every nested SidebarMenuSub, so
                  a folder nested 3-4 levels deep can eat most of the sidebar's
                  width before any title text renders, truncating even short
                  names ("Purchase Orders" -> "Pu..."). Still keeps the
                  border-l hierarchy cue, just narrower.

                  LEFT-only (`ml`/`pl`, not `mx`/`px`): the indent is a
                  hierarchy cue and belongs on the leading edge. Applying it
                  symmetrically also pulled every child's RIGHT edge 13px in
                  from its parent folder's (measured: folder row ended at
                  x=247, its children at x=234 on a 255px sidebar), so the
                  hover controls of a folder and of its own children never
                  lined up in the same column. */}
              <SidebarMenuSub className="ml-2 mr-0 translate-x-0 pl-1.5 pr-0">
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
                      // Children inherit the group's opt-in — a draggable group
                      // is draggable all the way down, at every depth.
                      groupDraggable,
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
      return rowDragEnabled && item.id ? (
        <DraggableRow
          key={itemKey}
          id={item.id}
          depth={depth}
          isContainer
          render={renderFolderRow}
        />
      ) : (
        renderFolderRow()
      );
    }

    // Plain leaf row (no sub-items). The top level keeps the richer
    // SidebarMenuButton-based row (badge, delete action); any nested depth
    // keeps the more compact SidebarMenuSubButton row — same as before this
    // became recursive, just now available at every depth, not only depth 1.
    if (depth === 0) {
      const leafCanDrag = rowDragEnabled && Boolean(item.id);
      const leafActionCount = countRowActions(item, leafCanDrag);
      const renderLeafRow = (dragProps?: NavRowDragProps) => (
        <SidebarMenuItem
          key={itemKey}
          ref={dragProps?.setNodeRef}
          style={dragProps?.style}
          className={`group/nav-row ${dropIndicatorClass(item.id)}`}
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
          {leafActionCount > 0 &&
            renderRowActions({
              itemKey,
              item,
              canDrag: leafCanDrag,
              dragProps,
              moreActionsTitle,
            })}
        </SidebarMenuItem>
      );
      return rowDragEnabled && item.id ? (
        <DraggableRow
          key={itemKey}
          id={item.id}
          depth={depth}
          isContainer={false}
          render={renderLeafRow}
        />
      ) : (
        renderLeafRow()
      );
    }

    const isSubItemActive = isSiblingActiveMatch;
    const SubIcon = item.icon;
    const subCanDrag = rowDragEnabled && Boolean(item.id);
    const subActionCount = countRowActions(item, subCanDrag);
    const renderSubItemRow = (dragProps?: NavRowDragProps) => (
      <SidebarMenuSubItem
        key={itemKey}
        ref={dragProps?.setNodeRef}
        style={dragProps?.style}
        className={`group/nav-row relative ${dropIndicatorClass(item.id)}`}
      >
        <SidebarMenuSubButton
          asChild
          isActive={isSubItemActive}
          className={navRowTrailingPadding(subActionCount)}
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
        {subActionCount > 0 &&
          renderRowActions({
            itemKey,
            item,
            canDrag: subCanDrag,
            dragProps,
            moreActionsTitle,
          })}
      </SidebarMenuSubItem>
    );
    return rowDragEnabled && item.id ? (
      <DraggableRow
        key={itemKey}
        id={item.id}
        depth={depth}
        isContainer={false}
        render={renderSubItemRow}
      />
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
                {group.items.map((item, itemIndex) =>
                  renderNavRow(item, itemIndex, "item", 0, false, group.draggable ?? false),
                )}
              </SidebarMenu>
            )}
          </SidebarGroup>
        );
      })}
    </div>
  );

  if (!dragEnabled) return content;

  const activeDragTitle = dragState ? dragRowTitles.get(dragState.activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // `Always`, not the default "measure once before dragging": the sidebar is
      // a scroll container and folders stay interactive mid-drag, so a rect
      // captured at drag start goes stale the moment the list scrolls. Stale
      // rects are exactly what this rewrite exists to eliminate.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        resolvedDropRef.current = null;
        setDrag(null);
      }}
    >
      {content}
      {/* Now that rows no longer translate, nothing would follow the cursor
          without this — the drag would read as "the row just faded". */}
      <DragOverlay dropAnimation={null}>
        {activeDragTitle ? (
          <div className="pointer-events-none flex h-8 max-w-56 items-center gap-2 truncate rounded-md border border-sidebar-border bg-sidebar px-2 text-sm text-sidebar-foreground shadow-lg">
            <GripVertical className="size-3.5 shrink-0 text-sidebar-foreground/50" />
            <span className="truncate">{activeDragTitle}</span>
          </div>
        ) : null}
      </DragOverlay>
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
