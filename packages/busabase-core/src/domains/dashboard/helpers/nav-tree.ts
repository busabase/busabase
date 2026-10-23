import { hasCapability } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import type { NavItem } from "openlib/ui/dashboard";
import { nodeIconGlyph, resolveNodeIcon } from "./node-icons";

/**
 * The detail route a node's sidebar row links to, or `null` when its type has no
 * detail screen. A Base is addressed by slug under `/base`; every other type by
 * `/{type}/{slug}`. Pure and client-safe, so the member workbench and the public
 * shared-folder page link to the same place.
 */
export function nodeHref(node: { type: string; slug: string }): string | null {
  if (node.type === "base") {
    return node.slug ? `/base/${node.slug}` : null;
  }
  return hasCapability(node.type, "hasDetail") ? `/${node.type}/${node.slug}` : null;
}

export interface NavTreeOptions {
  /**
   * Host-supplied ids of folders whose lazy children are being fetched right now;
   * drives the folder row's loading state.
   */
  loadingNodeIds?: ReadonlySet<string>;
  /**
   * Rows this host cannot offer. The public page drops types an anonymous link
   * can never open; the member workbench keeps everything.
   */
  include?: (node: NodeVO) => boolean;
  /**
   * Layered over each row after its shape is built, at every depth. The member
   * sidebar adds the "•••" menu, add-child and share/lock markers here; a host
   * with nothing to add (the public page) leaves it out. `href` is the node's
   * `nodeHref`, which is `null` for a container with no detail screen.
   */
  decorate?: (node: NodeVO, shape: "container" | "leaf", href: string | null) => Partial<NavItem>;
}

/**
 * Build the NavItem(s) for a node tree — a collapsible folder row (with its own
 * recursively-built `items`) if the node is a container, otherwise a plain
 * clickable leaf row if it has a detail screen, otherwise nothing. Applied at
 * EVERY depth, so a folder nested arbitrarily deep gets the exact same row
 * treatment as a top-level one — the sidebar (NavMain) renders `NavItem.items`
 * recursively, so nothing here needs to flatten nested folders away.
 *
 * `node.hasChildren`/`node.children` carry through to `NavItem.hasChildren`
 * regardless of depth: a node sitting at a `nodes.list` depth boundary has
 * `children: []` but `hasChildren: true`, so it still renders as an
 * expandable folder (NavMain) with an `onExpand` affordance instead of
 * silently looking like an empty leaf. `loadingNodeIds` drives the row's
 * loading state for exactly that case.
 */
export function buildNavItems(nodes: readonly NodeVO[], options: NavTreeOptions = {}): NavItem[] {
  return nodes.flatMap((node) => buildNavItem(node, options));
}

function buildNavItem(node: NodeVO, options: NavTreeOptions): NavItem[] {
  if (hasCapability(node.type, "hidden") || options.include?.(node) === false) return [];
  const icon = nodeIconGlyph(resolveNodeIcon(node));
  const href = nodeHref(node);
  if (hasCapability(node.type, "container")) {
    return [
      {
        title: node.name,
        url: href ?? "",
        icon,
        id: node.id,
        items: buildNavItems(node.children, options),
        hasChildren: node.hasChildren ?? node.children.length > 0,
        isLoadingChildren: options.loadingNodeIds?.has(node.id) ?? false,
        ...options.decorate?.(node, "container", href),
      },
    ];
  }
  return href
    ? [
        {
          title: node.name,
          url: href,
          icon,
          id: node.id,
          ...options.decorate?.(node, "leaf", href),
        },
      ]
    : [];
}
