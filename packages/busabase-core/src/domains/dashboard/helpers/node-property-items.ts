// Shared `{label, value}` property-list builders for the Node Settings
// dialog's Info tab. Extracted from the two `Info` popovers that used to live
// inline in `node-detail-views.tsx` (the file-tree — skill/drive/airapp — and
// file-node views) so the Tab can reuse the exact same rows without a second
// copy of the label/value assembly. `NodeSettingsDialog`'s Info tab renders
// these into the SAME `<dl>` markup those popovers used, just under a Tab
// container instead of a `Popover`.
//
// Every other node type (folder/doc/base/form/whiteboard/workflow/html) never
// had its own Info popover before this dialog existed — `genericNodePropertyItems`
// is the new, purely additive fallback for those, built from fields every
// `NodeDetailVO` variant's `.node` already carries.

import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { CoreI18nMessages } from "../../../i18n/messages";
import { formatFullTime } from "./format";

export interface NodePropertyItem {
  label: string;
  value: string;
}

/** skill / drive / airapp — the file-tree node types. */
export const fileTreePropertyItems = (
  detail: Extract<NodeDetailVO, { type: "skill" | "drive" | "airapp" }>,
  messages: CoreI18nMessages,
): NodePropertyItem[] =>
  [
    { label: messages.nodeDetail.files, value: String(detail.files.length) },
    { label: messages.nodeDetail.visibility, value: detail.visibility },
    detail.version ? { label: messages.nodeDetail.version, value: `v${detail.version}` } : null,
    detail.entryFile ? { label: messages.nodeDetail.entryFile, value: detail.entryFile } : null,
  ].filter((item): item is NodePropertyItem => Boolean(item));

/** file — a single Asset-backed node. */
export const fileNodePropertyItems = (
  detail: Extract<NodeDetailVO, { type: "file" }>,
  messages: CoreI18nMessages,
): NodePropertyItem[] =>
  [
    { label: messages.nodeDetail.fileName, value: detail.asset.fileName },
    { label: messages.nodeDetail.mediaType, value: detail.asset.mimeType },
    { label: messages.nodeDetail.fileSize, value: formatAssetSizeInline(detail.asset.size) },
    { label: messages.nodeDetail.assetId, value: detail.asset.id },
    detail.asset.contentHash
      ? { label: messages.nodeDetail.contentHash, value: detail.asset.contentHash }
      : null,
  ].filter((item): item is NodePropertyItem => Boolean(item));

// Deliberately re-implemented rather than imported from `./assets`'
// `formatAssetSize` (a client `"use client"` component module) — this helper
// file has no `"use client"` directive of its own so it stays importable from
// anywhere (including a future server-rendered summary), and the format is a
// one-line, easily-kept-in-sync computation.
const formatAssetSizeInline = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Fallback for every node type with no richer typed detail (folder, doc,
 * base, form, whiteboard, workflow, html) — built purely from the base
 * `NodeVO` fields every `NodeDetailVO` variant's `.node` carries.
 */
export const genericNodePropertyItems = (
  detail: NodeDetailVO,
  messages: CoreI18nMessages,
  locale: Intl.LocalesArgument,
): NodePropertyItem[] => {
  const { node } = detail;
  return [
    { label: messages.common.slug, value: node.slug },
    {
      label: messages.nodeDetail.visibility,
      // No explicit per-node override: don't assert WHO can see it — the open
      // (vs. restricted-by-default) space mode is a cloud-only concept this
      // shared component cannot see (contrast the Permissions tab's
      // `NodePermissionsPanel`, which fetches `spaces.getCurrent` itself and
      // knows the real answer). Claiming "Everyone in this space can see
      // this" here would contradict that tab for the exact same node whenever
      // the space is in Restricted mode.
      value: node.explicitVisibility ?? messages.nodeDetail.visibilityDefault,
    },
    { label: messages.common.created, value: formatFullTime(node.createdAt, locale) },
    { label: messages.common.updated, value: formatFullTime(node.updatedAt, locale) },
  ];
};

/** Dispatches to the right builder for `detail.type`. */
export const getNodePropertyItems = (
  detail: NodeDetailVO,
  messages: CoreI18nMessages,
  locale: Intl.LocalesArgument,
): NodePropertyItem[] => {
  switch (detail.type) {
    case "skill":
    case "drive":
    case "airapp":
      return fileTreePropertyItems(detail, messages);
    case "file":
      return fileNodePropertyItems(detail, messages);
    default:
      return genericNodePropertyItems(detail, messages, locale);
  }
};
