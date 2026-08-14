import { getNodeType, type NodeType } from "busabase-contract/domains";
import type { CoreI18nMessages } from "../../../i18n";
import type { LoadedNode } from "../node-detail-registry";
import type { BusabaseBreadcrumbItem } from "./view-types";

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
): BusabaseBreadcrumbItem[] | null => {
  if (!route) return null;

  const definition = getNodeType(route.type);
  if (!definition?.capabilities.hasDetail || route.type === "base") return null;

  const nodeName =
    loadedNode?.type === route.type && loadedNode.slug === route.slug
      ? loadedNode.name
      : getLocalizedNodeTypeLabel(messages, route.type);

  return [{ href: "/home", label: messages.nav.workspace }, { label: nodeName }];
};
