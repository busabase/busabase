import type { LucideIcon } from "lucide-react";

export interface NavItemAction {
  title: string;
  icon?: LucideIcon;
  action?: string;
  url?: string;
  onSelect?: () => void;
  variant?: "default" | "destructive";
}

export interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  /**
   * Sub-items, recursively — a sub-item is itself a full `NavItem`, so it may
   * carry its own `items` and render as a nested collapsible folder at any
   * depth (see NavMain, which renders rows recursively). An item with no
   * `items` (or an empty array) is a plain leaf row. This is a
   * backward-compatible widening of the previous flat, leaf-only sub-item
   * shape: a flat list of leaves is still valid, since a leaf is just a
   * `NavItem` whose `items` is undefined. `id` (below) doubles as the
   * drag-and-drop identity at every depth — a sub-item needs one to
   * participate in drag-and-drop (see NavMain's `onNodeDrop`).
   */
  items?: NavItem[];
  /**
   * Whether this item has children beyond what `items` carries. When `true`
   * and `items` is empty/undefined, NavMain still renders the row as an
   * expandable folder (chevron + `Collapsible`) instead of a leaf — for a
   * consumer that lazy-loads a folder's contents on first expand rather than
   * eagerly loading the whole tree. Omit/`false` is the existing behavior:
   * a row with no `items` renders as a plain leaf.
   */
  hasChildren?: boolean;
  /**
   * Shows a loading row inside this folder's `CollapsibleContent` (e.g. a
   * skeleton/spinner) while its children are being fetched — pair with
   * `hasChildren` + `onExpand` for a lazy-loaded folder. Ignored for a leaf
   * row (no `items`/`hasChildren`).
   */
  isLoadingChildren?: boolean;
  /**
   * Optional ID for the item (e.g., task ID for delete operations). Also
   * doubles as the drag-and-drop identity when NavMain's `onNodeDrop` is
   * supplied — items without an `id` are never draggable/droppable.
   */
  id?: string;
  /**
   * Optional delete callback for items that can be deleted
   * @param id - The ID of the item to delete
   */
  onDelete?: (id: string) => void;
  /**
   * Optional "add child" callback (e.g. a folder's hover "+"). Renders a Plus
   * action on the item that invokes this when clicked.
   */
  onAddChild?: () => void;
  addChildTitle?: string;
  /**
   * Optional dropdown actions rendered from a row's hover "more" affordance.
   */
  actions?: NavItemAction[];
  moreActionsTitle?: string;
  /**
   * Optional click action key (e.g., "billing") for items that trigger actions instead of navigation
   */
  onClick?: string;
  /**
   * Optional badge content to display next to the item (e.g., counts)
   */
  badge?: string | number;
  /**
   * Optional space name for recent task items
   */
  spaceName?: string;
  /**
   * Optional ISO timestamp for item creation time
   */
  createdAt?: string;
  /**
   * Optional status for recent task items
   */
  status?: "pending" | "in_progress" | "waiting_for_input" | "completed" | "failed" | "cancelled";
}

export interface NavGroup {
  label: string;
  icon?: LucideIcon;
  items: NavItem[];
  /**
   * Optional variant hint for SidebarTaskList rendering when this group is dynamic (e.g., Recent Tasks).
   */
  taskListVariant?: "dashboard" | "agent-manager";
  /**
   * Icon component for header action button (e.g., Plus icon for add button)
   */
  headerAction?: LucideIcon;
  /**
   * Accessible title/tooltip for the header action button
   */
  headerActionTitle?: string;
  /**
   * Whether items should be loaded dynamically (e.g., recent tasks)
   */
  isDynamic?: boolean;
  /**
   * Additional CSS class for the SidebarGroup
   * e.g., "group-data-[collapsible=icon]:hidden" to hide when sidebar is collapsed
   */
  className?: string;
  /**
   * Whether the task list is expanded (showing all tasks with scroll)
   */
  isExpanded?: boolean;
  /**
   * Callback when "See All" / "Show Less" is clicked
   */
  onExpandToggle?: () => void;
  /**
   * Total count of tasks (used to show "See All" when there are more)
   */
  totalCount?: number;
  /**
   * Default visible count before expansion
   */
  defaultVisibleCount?: number;
}

export interface Space {
  name: string;
  logo: LucideIcon | string; // Support both icon components and custom image URLs
  plan?: string;
  id?: string;
  /**
   * Discriminates a synthetic "remote space" (e.g. Busabase's Local ↔ Cloud
   * Tunnel: a connected self-hosted instance surfaced as a space) from a real
   * space. Additive + optional — absent/undefined for every existing space
   * producer; `SpaceSelector` only renders the "Remote" treatment when this is
   * set, so a `Space` without it renders byte-for-byte as it always has.
   */
  kind?: "remote_tunnel";
  /**
   * Whether a `kind: "remote_tunnel"` space's connection is currently live.
   * Undefined/irrelevant for a real space.
   */
  online?: boolean;
}

export interface UserData {
  name: string;
  email: string;
  avatar: string;
}

export interface UserMenuItem {
  label: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string }>;
  external?: boolean;
  onClick?: () => void;
}

export interface AppBranding {
  name: string;
  /** URL path to the logo image */
  logo: string;
  href?: string;
  /** Optional description shown below the name */
  description?: string;
}
