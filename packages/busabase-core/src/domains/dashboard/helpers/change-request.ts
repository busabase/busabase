import type { ChangeRequestVO, NodeVO, OperationKind, OperationVO, RecordVO } from "../../../types";
import { OPERATION_KINDS, OPERATION_META } from "../../registry";
import { fieldPreviewText } from "./field";
import { fieldValueToString, shortIdentifier } from "./format";

export const statusTone = (status: string) => {
  if (status === "merged") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status === "approved") {
    return "border-teal-200 bg-teal-50 text-teal-800";
  }
  if (status === "conflict") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (status === "rejected" || status === "abandoned") {
    return "border-gray-200 bg-gray-50 text-gray-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
};

export const changeRequestStatusLabel = (status: string) => {
  if (status === "in_review") {
    return "In review";
  }
  if (status === "changes_requested") {
    return "Changes requested";
  }
  if (status === "conflict") {
    return "Conflict";
  }
  if (status === "rejected" || status === "abandoned") {
    return "Closed";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
};

export const operationOrder: OperationKind[] = [
  "record_create",
  "record_update",
  "record_delete",
  "record_variant",
  "view_create",
  "view_update",
  "view_delete",
  "node_create",
  "node_rename",
  "node_delete",
  "node_move",
  "skill_file_create",
  "skill_file_update",
  "skill_file_delete",
  "skill_metadata_update",
];

// Operation labels/tones come from the node-type registry (single source of truth).
export const operationMeta = OPERATION_META;

export const getChangeRequestScopeName = (changeRequest: ChangeRequestVO) =>
  changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree";

export const getNodeHref = (node: NodeVO | null | undefined) => {
  if (!node) {
    return null;
  }
  if (node.type === "skill") {
    return `/skill/${node.slug}`;
  }
  if (node.type === "doc") {
    return `/doc/${node.slug}`;
  }
  if (node.type === "folder") {
    return `/folder/${node.slug}`;
  }
  return null;
};

export const getChangeRequestScopeHref = (changeRequest: ChangeRequestVO) =>
  changeRequest.base ? `/base/${changeRequest.base.slug}` : getNodeHref(changeRequest.node);

// Canonical target an operation points at, for "jump to" navigation. Null when
// there is nothing to open yet (e.g. a record create before it is merged).
export const getOperationTargetHref = (changeRequest: ChangeRequestVO, operation: OperationVO) => {
  const baseSlug = changeRequest.base?.slug;
  if (baseSlug && operation.operation.startsWith("record_")) {
    const recordId = operation.targetRecordId ?? operation.mergedRecordId;
    return recordId ? `/base/${baseSlug}/${recordId}` : null;
  }
  if (baseSlug && operation.operation.startsWith("view_")) {
    const viewId = operation.targetViewId ?? operation.mergedViewId;
    return viewId ? `/base/${baseSlug}/${viewId}` : null;
  }
  return getNodeHref(changeRequest.node);
};

export const getOperationTargetLabel = (operation: OperationVO) => {
  if (operation.operation.startsWith("view_")) {
    return "Open view";
  }
  if (operation.targetType === "node") {
    return "Open node";
  }
  return "Open record";
};

export const getOperationTitle = (operation: OperationVO | null | undefined) => {
  if (!operation) {
    return "";
  }

  const title =
    fieldValueToString(operation.headCommit.fields.title) ||
    fieldValueToString(operation.headCommit.fields.name) ||
    fieldValueToString(operation.headCommit.fields.subject);

  if (title) {
    return title;
  }

  return `${operationMeta[operation.operation].label} ${shortIdentifier(
    operation.targetRecordId ??
      operation.sourceRecordId ??
      operation.targetViewId ??
      operation.mergedViewId ??
      operation.headCommitId,
  )}`;
};

export const getRecordTitle = (record: RecordVO | null | undefined) => {
  if (!record) {
    return "Record";
  }

  // The record title is the value of the base's PRIMARY field (its first field
  // by position — the Airtable/Baserow convention), not a hard-coded
  // title/name/subject guess. So a base whose first field is `name`, `title`,
  // or anything else displays correctly, and relation chips show that value.
  const primaryField = record.base.fields[0];
  const primary = primaryField
    ? fieldPreviewText(record.headCommit.fields[primaryField.slug], primaryField.type)
    : "";
  return primary || shortIdentifier(record.id);
};

export const getOperationCounts = (operations: OperationVO[]) =>
  operations.reduce(
    (counts, operation) => {
      counts[operation.operation] += 1;
      return counts;
    },
    Object.fromEntries(OPERATION_KINDS.map((kind) => [kind, 0])) as Record<OperationKind, number>,
  );

export const getChangeRequestTitle = (changeRequest: ChangeRequestVO) => {
  if (changeRequest.operationCount > 1) {
    return `${changeRequest.operationCount} operation change request`;
  }

  return getOperationTitle(changeRequest.primaryOperation) || "Untitled change request";
};

export const getChangeRequestSummary = (changeRequest: ChangeRequestVO) => {
  const counts = getOperationCounts(changeRequest.operations);
  const parts = operationOrder
    .filter((operation) => counts[operation] > 0)
    .map((operation) => `${counts[operation]} ${operationMeta[operation].label.toLowerCase()}`);

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return `${changeRequest.operationCount} item${changeRequest.operationCount === 1 ? "" : "s"}`;
};

export const getChangeRequestOperationLabel = (changeRequest: ChangeRequestVO) =>
  `${changeRequest.operationCount} operation${changeRequest.operationCount === 1 ? "" : "s"}`;

export const getChangeRequestRiskHints = (changeRequest: ChangeRequestVO) => {
  const hints = new Set<string>();
  for (const operation of changeRequest.operations) {
    if (operation.operation.endsWith("_delete")) {
      hints.add("destructive");
    }
    if (operation.operation.startsWith("record_")) {
      const fields = operation.headCommit.fields;
      for (const [slug, value] of Object.entries(fields)) {
        const field = changeRequest.base?.fields.find((item) => item.slug === slug);
        if (field?.type === "html") {
          hints.add("HTML");
        }
        if (field?.type === "code") {
          hints.add((field.options.code?.language ?? "code").toUpperCase());
        }
        if (field?.type === "attachment") {
          hints.add("attachment");
        }
        if (field?.type === "relation") {
          hints.add("relation");
        }
        if (typeof value === "string" && value.length > 500) {
          hints.add("long text");
        }
      }
    }
  }
  return Array.from(hints).slice(0, 2);
};

export const getChangeRequestBrief = (changeRequest: ChangeRequestVO) => {
  const scope = getChangeRequestScopeName(changeRequest);
  const summary = getChangeRequestSummary(changeRequest);
  const risks = getChangeRequestRiskHints(changeRequest);
  const riskText = risks.length > 0 ? ` Watch ${risks.join(" and ")} changes.` : "";
  return `${getChangeRequestOperationLabel(changeRequest)} in ${scope}: ${summary}.${riskText}`;
};

export const getChangeRequestReviewMessage = (changeRequest: ChangeRequestVO) => {
  if (changeRequest.status === "approved") {
    return "Approved · ready to merge";
  }
  if (changeRequest.status === "changes_requested") {
    return "Changes requested · awaiting revision";
  }
  if (changeRequest.status === "rejected" || changeRequest.status === "abandoned") {
    return "Closed";
  }
  if (changeRequest.status === "merged") {
    return "Merged into Base";
  }
  return "Waiting for your review";
};

export const getOperationImpact = (operation: OperationVO) => {
  if (operation.operation === "record_create") {
    return "Adds a new record";
  }
  if (operation.operation === "record_update") {
    return `Updates ${shortIdentifier(operation.targetRecordId)}`;
  }
  if (operation.operation === "record_delete") {
    return operation.deleteMode === "archive"
      ? `Archives ${shortIdentifier(operation.targetRecordId)}`
      : `Deletes ${shortIdentifier(operation.targetRecordId)}`;
  }
  if (operation.operation === "record_variant") {
    return `Variants ${shortIdentifier(operation.sourceRecordId)}`;
  }
  if (operation.operation === "view_create") {
    return "Adds a new view";
  }
  if (operation.operation === "view_update") {
    return `Updates view ${shortIdentifier(operation.targetViewId ?? operation.mergedViewId)}`;
  }
  if (operation.operation === "view_delete") {
    return `Deletes view ${shortIdentifier(operation.targetViewId ?? operation.mergedViewId)}`;
  }
  if (operation.operation.startsWith("skill_file_")) {
    return `${operationMeta[operation.operation].label} ${operation.filePath ?? "file"}`;
  }
  return `${operationMeta[operation.operation].label} ${shortIdentifier(operation.nodeId)}`;
};

export const isDerivedFieldSlug = (name: string, slug: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") === slug;
