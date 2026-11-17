import { getNodeType, type NodeType } from "busabase-contract/domains";
import type { CoreI18nMessages } from "../../../i18n";
import type { LoadedNode } from "../node-detail-registry";
import { nodeHref } from "./nav-tree";
import type { BusabaseBreadcrumbItem } from "./view-types";

/** A folder on the way from the workspace root to the open node. Root-first. */
export interface BreadcrumbAncestor {
  id: string;
  name: string;
  slug: string;
  type: string;
}

/** The bits of a node tree `ancestorFoldersFromTree` walks. `NodeVO` satisfies it. */
export interface BreadcrumbTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  type: string;
  children?: readonly BreadcrumbTreeNode[];
}

export interface BreadcrumbNodeRef {
  type: string;
  slug: string;
}

const MAX_BREADCRUMB_ANCESTORS = 64;

/**
 * Folder crumbs for `ancestors`, each linking to that folder's detail route
 * (the same place the sidebar row opens). The workspace root is never in this
 * list — callers already render it as the leading "Workspace" crumb — and a
 * non-folder ancestor is skipped because only folders sit between the root
 * and a node.
 */
export const ancestorFolderBreadcrumbItems = (
  ancestors: readonly BreadcrumbAncestor[],
): BusabaseBreadcrumbItem[] =>
  ancestors.flatMap((ancestor) => {
    if (ancestor.type !== "folder") return [];
    const href = nodeHref(ancestor);
    const label = ancestor.name.trim();
    if (!href || !label) return [];
    return [{ href, label }];
  });

/**
 * Insert ancestor folders after the leading crumb (Workspace, or whatever a
 * chromeless host will slice off and replace). An empty chain leaves the
 * trail untouched, so Home / Inbox / Search stay one segment.
 */
export const withAncestorFolders = (
  items: readonly BusabaseBreadcrumbItem[],
  ancestors: readonly BreadcrumbAncestor[],
): BusabaseBreadcrumbItem[] => {
  const folders = ancestorFolderBreadcrumbItems(ancestors);
  const head = items[0];
  if (!head || folders.length === 0) return [...items];
  return [head, ...folders, ...items.slice(1)];
};

/**
 * Ancestors of `target` that are already in `nodes`, root-first, excluding the
 * target and the workspace root (`parentId === null`). Used while
 * `nodes.ancestors` is still in flight, and for anonymous renders that never
 * call it — the visible tree is the only path those visitors are allowed to see.
 * A deep node the depth-bounded tree has not loaded yet returns `[]`; the
 * server summary fills that in when it arrives.
 */
export const ancestorFoldersFromTree = (
  nodes: readonly BreadcrumbTreeNode[],
  target: BreadcrumbNodeRef,
): BreadcrumbAncestor[] => {
  const byId = new Map<string, BreadcrumbTreeNode>();
  const found: { node: BreadcrumbTreeNode | null } = { node: null };
  const visit = (list: readonly BreadcrumbTreeNode[]) => {
    for (const node of list) {
      byId.set(node.id, node);
      if (
        !found.node &&
        node.type === target.type &&
        (node.slug === target.slug || node.id === target.slug)
      ) {
        found.node = node;
      }
      if (node.children && node.children.length > 0) visit(node.children);
    }
  };
  visit(nodes);
  const match = found.node;
  if (!match) return [];

  const chain: BreadcrumbAncestor[] = [];
  const seen = new Set<string>([match.id]);
  let parentId = match.parentId;
  while (parentId && chain.length < MAX_BREADCRUMB_ANCESTORS) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = byId.get(parentId);
    // Missing parent: not loaded, or the workspace root was unwrapped out of
    // the tree. Root itself (`parentId === null`) is the "Workspace" crumb.
    if (!parent || parent.parentId === null) break;
    chain.push({
      id: parent.id,
      name: parent.name,
      slug: parent.slug,
      type: parent.type,
    });
    parentId = parent.parentId;
  }
  return chain.reverse();
};

/**
 * Indexes hidden behind the narrow-screen "…" menu: everything between the
 * first crumb and the last two, once the trail is long enough that showing
 * every segment would wrap a 360px header. Four crumbs or fewer stay inline
 * so a node one or two folders down is still distinguishable without opening
 * the menu.
 */
export const narrowCollapsedBreadcrumbIndexes = (length: number): number[] => {
  if (length <= 4) return [];
  const indexes: number[] = [];
  for (let index = 1; index < length - 2; index += 1) indexes.push(index);
  return indexes;
};

interface NodeDetailRoute {
  slug: string;
  type: string;
}

const getLocalizedNodeTypeLabel = (messages: CoreI18nMessages, type: string): string => {
  const labels: Record<NodeType, string> = {
    airapp: messages.nodeDetail.airapp,
    base: messages.nodeDetail.base,
    doc: messages.nodeDetail.doc,
    drive: messages.nodeDetail.drive,
    file: messages.nodeDetail.file,
    folder: messages.nodeDetail.folder,
    form: messages.nodeDetail.form,
    html: messages.nodeDetail.html,
    skill: messages.nodeDetail.skill,
    whiteboard: messages.nodeDetail.whiteboard,
    workflow: messages.nodeDetail.workflow,
  };

  return Object.hasOwn(labels, type)
    ? labels[type as NodeType]
    : (getNodeType(type)?.label ?? type);
};

/**
 * Resolve the shared topbar trail for registry-driven node detail routes.
 * Base is excluded because its record/view/design routes own richer trails.
 */
export const getNodeDetailBreadcrumbItems = (
  route: NodeDetailRoute | null,
  loadedNode: LoadedNode | null,
  messages: CoreI18nMessages,
  ancestors: readonly BreadcrumbAncestor[] = [],
): BusabaseBreadcrumbItem[] | null => {
  if (!route) return null;

  const definition = getNodeType(route.type);
  if (!definition?.capabilities.hasDetail || route.type === "base") return null;

  const nodeName =
    loadedNode?.type === route.type && loadedNode.slug === route.slug
      ? loadedNode.name
      : getLocalizedNodeTypeLabel(messages, route.type);

  return withAncestorFolders(
    [
      { href: "/home", label: messages.nav.workspace },
      { isNode: true, label: nodeName },
    ],
    ancestors,
  );
};
