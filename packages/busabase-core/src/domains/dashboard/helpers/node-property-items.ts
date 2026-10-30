// Shared `{label, value}` property-list builders for the Node Settings
// dialog's Info tab. Extracted from the two `Info` popovers that used to live
// inline in `node-detail-views.tsx` (the file-tree — skill/drive/airapp — and
// file-node views) so the Tab can reuse the exact same rows without a second
// copy of the label/value assembly.
//
// Every node type gets the same identity rows (kind, id, slug, link,
// visibility). Type-specific facts are appended only when the detail payload
// already carries them — a file's size, a skill's version, a doc's length.
// Counts that need another endpoint (Base rows, form submissions) are NOT
// invented here; the Info panel fetches those and renders them beside this list.
// Created/updated times stay out of this list on purpose: the panel pairs each
// timestamp with its person, and repeating them below would just be noise.

import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { NodeType } from "busabase-contract/domains";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { nodeHref } from "./nav-tree";

export interface NodePropertyItem {
  label: string;
  value: string;
  /** Stable React key when two rows could share a label. */
  key?: string;
  /** Copies `copyValue ?? value`. */
  copyable?: boolean;
  copyValue?: string;
  /** In-app or absolute URL. The visible `value` stays the short path. */
  href?: string;
  mono?: boolean;
}

export interface NodeInfoSections {
  identity: NodePropertyItem[];
  link: NodePropertyItem | null;
  access: NodePropertyItem[];
  specifics: NodePropertyItem[];
}

const nodeTypeLabel = (type: string, messages: CoreI18nMessages): string => {
  const labels: Record<NodeType, string> = {
    skill: messages.nodeDetail.skill,
    drive: messages.nodeDetail.drive,
    airapp: messages.nodeDetail.airapp,
    file: messages.nodeDetail.file,
    doc: messages.nodeDetail.doc,
    folder: messages.nodeDetail.folder,
    base: messages.nodeDetail.base,
    form: messages.nodeDetail.form,
    whiteboard: messages.nodeDetail.whiteboard,
    workflow: messages.nodeDetail.workflow,
    html: messages.nodeDetail.html,
  };
  return labels[type as NodeType] ?? type;
};

const visibilityWord = (
  value: "private" | "workspace" | "public",
  messages: CoreI18nMessages,
): string => {
  if (value === "private") return messages.form.private;
  if (value === "workspace") return messages.nav.workspace;
  return messages.nodeDetail.visibilityPublic;
};

const visibilityValue = (detail: NodeDetailVO, messages: CoreI18nMessages): string => {
  if (detail.type === "skill" || detail.type === "drive" || detail.type === "airapp") {
    return visibilityWord(detail.visibility, messages);
  }
  const explicit = detail.node.explicitVisibility;
  if (!explicit) return messages.nodeDetail.visibilityDefault;
  return visibilityWord(explicit, messages);
};

/** Unicode code points, so a CJK document is not counted as UTF-16 units. */
export const characterCount = (value: string): number => Array.from(value).length;

// Deliberately re-implemented rather than imported from `./assets`'
// `formatAssetSize` (a client `"use client"` component module) — this helper
// file has no `"use client"` directive of its own so it stays importable from
// anywhere, and the format is a one-line, easily-kept-in-sync computation.
export const formatByteSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileTreeSpecifics = (
  detail: Extract<NodeDetailVO, { type: "skill" | "drive" | "airapp" }>,
  messages: CoreI18nMessages,
): NodePropertyItem[] => {
  const totalBytes = detail.files.reduce(
    (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
    0,
  );
  return [
    { label: messages.nodeDetail.files, value: String(detail.files.length) },
    { label: messages.nodeDetail.totalSize, value: formatByteSize(totalBytes) },
    ...(detail.version
      ? [{ label: messages.nodeDetail.version, value: `v${detail.version}` }]
      : []),
    ...(detail.entryFile
      ? [{ label: messages.nodeDetail.entryFile, value: detail.entryFile, mono: true }]
      : []),
    ...(detail.type === "airapp"
      ? [
          {
            label: messages.airapp.engineLabel,
            value: detail.node.settings?.airappEngine
              ? {
                  browser: messages.airapp.engineBrowser,
                  local: messages.airapp.engineLocal,
                  remote: messages.airapp.engineRemote,
                }[detail.node.settings.airappEngine]
              : messages.airapp.engineFollowApp,
          },
        ]
      : []),
  ];
};

const fileSpecifics = (
  detail: Extract<NodeDetailVO, { type: "file" }>,
  messages: CoreI18nMessages,
): NodePropertyItem[] => {
  const items: NodePropertyItem[] = [
    { label: messages.nodeDetail.fileName, value: detail.asset.fileName },
    { label: messages.nodeDetail.mediaType, value: detail.asset.mimeType, mono: true },
    { label: messages.nodeDetail.fileSize, value: formatByteSize(detail.asset.size) },
    { label: messages.nodeDetail.assetId, value: detail.asset.id, mono: true, copyable: true },
  ];
  if (detail.asset.contentHash) {
    items.push({
      label: messages.nodeDetail.contentHash,
      value: detail.asset.contentHash,
      mono: true,
      copyable: true,
    });
  }
  return items;
};

const workflowSpecifics = (
  detail: Extract<NodeDetailVO, { type: "workflow" }>,
  messages: CoreI18nMessages,
): NodePropertyItem[] => {
  const { settings } = detail.document;
  return [
    { label: messages.nodeDetail.steps, value: String(detail.document.nodes.length) },
    { label: messages.nodeDetail.connections, value: String(detail.document.edges.length) },
    {
      label: messages.richNodes.executionMode,
      value:
        settings.executionMode === "event" ? messages.richNodes.event : messages.richNodes.manual,
    },
    {
      label: messages.richNodes.errorPolicy,
      value:
        settings.errorPolicy === "continue" ? messages.richNodes.continue : messages.richNodes.stop,
    },
    { label: messages.richNodes.concurrency, value: String(settings.concurrency) },
    { label: messages.richNodes.timeoutMs, value: String(settings.timeoutMs) },
  ];
};

const typeSpecifics = (detail: NodeDetailVO, messages: CoreI18nMessages): NodePropertyItem[] => {
  switch (detail.type) {
    case "skill":
    case "drive":
    case "airapp":
      return fileTreeSpecifics(detail, messages);
    case "file":
      return fileSpecifics(detail, messages);
    case "folder":
      return [{ label: messages.nodeDetail.contents, value: String(detail.children.length) }];
    case "doc":
      return [
        { label: messages.nodeDetail.characters, value: String(characterCount(detail.body)) },
      ];
    case "html":
      return [
        {
          label: messages.nodeDetail.characters,
          value: String(characterCount(detail.document.source)),
        },
      ];
    case "whiteboard":
      return [
        { label: messages.nodeDetail.elements, value: String(detail.document.elements.length) },
      ];
    case "workflow":
      return workflowSpecifics(detail, messages);
    default:
      return [];
  }
};

/**
 * Identity, link, visibility, and whatever this node's own payload already
 * knows. `linkHref` is the absolute in-app URL when the caller could build
 * one; the row still displays the short route.
 */
export const getNodeInfoSections = (
  detail: NodeDetailVO,
  messages: CoreI18nMessages,
  linkHref?: string | null,
): NodeInfoSections => {
  const { node } = detail;
  const path = nodeHref({ type: node.type, slug: node.slug });
  const href = linkHref || path;
  return {
    identity: [
      { key: "type", label: messages.richNodes.type, value: nodeTypeLabel(node.type, messages) },
      {
        key: "id",
        label: messages.nodeDetail.nodeId,
        value: node.id,
        mono: true,
        copyable: true,
      },
      { key: "slug", label: messages.common.slug, value: node.slug, mono: true, copyable: true },
    ],
    link: path
      ? {
          key: "link",
          label: messages.nodeDetail.inAppLink,
          value: path,
          href: href ?? path,
          copyable: true,
          copyValue: href ?? path,
          mono: true,
        }
      : null,
    access: [
      {
        key: "visibility",
        label: messages.nodeDetail.visibility,
        value: visibilityValue(detail, messages),
      },
    ],
    specifics: typeSpecifics(detail, messages),
  };
};

/** Flat list, for callers that do not care about section breaks. */
export const getNodePropertyItems = (
  detail: NodeDetailVO,
  messages: CoreI18nMessages,
): NodePropertyItem[] => {
  const sections = getNodeInfoSections(detail, messages);
  return [
    ...sections.identity,
    ...(sections.link ? [sections.link] : []),
    ...sections.access,
    ...sections.specifics,
  ];
};
