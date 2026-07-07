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
  items?: {
    title: string;
    url: string;
    icon?: LucideIcon;
  }[];
  /**
   * Optional ID for the item (e.g., task ID for delete operations)
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
  status?:
    | "pending"
    | "in_progress"
    | "waiting_for_input"
    | "completed"
    | "failed"
    | "cancelled"
    | "pending_fork";
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
