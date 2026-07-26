import {
  Activity,
  Archive,
  FileText,
  Github,
  Images,
  Inbox,
  Network,
  Table2,
} from "lucide-react-native";
import type { CoreMessages } from "~/i18n/messages";

export type NavKey = keyof CoreMessages["nav"];

/** A destination that takes you somewhere: tapping it navigates to `href`. */
export interface DrawerDestination {
  key: NavKey;
  href: string;
  icon: typeof Inbox;
  /** Extra route prefixes that also count as "you are here" (detail screens). */
  activePaths?: string[];
}

/**
 * The non-navigating entries in the same list. Web's Space Selector menu mixes
 * routes with one dialog opener ("Install from GitHub…"), and the menu is the
 * only place that entry exists — so the mobile list has to carry the same mix
 * rather than pretend everything in it is a route.
 *
 * Kept as a SEPARATE interface (rather than making `href` optional on
 * `DrawerDestination`) so every existing consumer that reads `.href` — the
 * drawer's pinned rows, the contextual row — keeps a non-optional `href` and
 * cannot silently navigate to `undefined`.
 */
export type DrawerActionKey = "installFromGithub";

export interface DrawerActionDestination {
  key: NavKey;
  action: DrawerActionKey;
  icon: typeof Inbox;
}

export type DrawerEntry = DrawerDestination | DrawerActionDestination;

export const isDrawerAction = (entry: DrawerEntry): entry is DrawerActionDestination =>
  "action" in entry;

/**
 * The top-level destinations that no longer sit permanently in the drawer —
 * they live in the Space Selector sheet instead, so the resting drawer is just
 * Home + Search + the (at most one) contextual row + the node tree.
 *
 * Mirrors the web dashboard's Space Selector menu
 * (packages/busabase-core/src/domains/dashboard/components/dashboard-shell.tsx),
 * plus the three mobile-only screens (Records, Bases, Graph View) that web
 * reaches from elsewhere. "Install from GitHub…" sits directly after Assets,
 * the same slot it occupies in the web menu.
 */
export const DRAWER_DESTINATIONS = [
  { key: "inbox", href: "/drawer/inbox", icon: Inbox, activePaths: ["/change-requests"] },
  { key: "activity", href: "/drawer/activity", icon: Activity },
  { key: "archived", href: "/drawer/archived", icon: Archive },
  { key: "assets", href: "/drawer/assets", icon: Images, activePaths: ["/assets"] },
  { key: "installFromGithub", action: "installFromGithub", icon: Github },
  { key: "records", href: "/drawer/records", icon: FileText, activePaths: ["/records"] },
  { key: "bases", href: "/drawer/bases", icon: Table2, activePaths: ["/base"] },
  { key: "graph", href: "/drawer/graph", icon: Network },
] as const satisfies ReadonlyArray<DrawerEntry>;

export const isPathActive = (pathname: string, basePath: string) =>
  pathname === basePath || pathname.startsWith(`${basePath}/`);

/**
 * An action entry is never "where you are" — it opens something in place and
 * leaves the route untouched, so it can never be highlighted or become the
 * drawer's contextual row.
 */
export const isDrawerItemActive = (pathname: string, item: DrawerEntry) =>
  isDrawerAction(item)
    ? false
    : [item.href, ...(item.activePaths ?? [])].some((path) => isPathActive(pathname, path));
