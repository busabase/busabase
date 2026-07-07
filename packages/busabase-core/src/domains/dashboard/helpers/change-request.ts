import { getNodeType, OPERATION_KINDS, OPERATION_META } from "busabase-contract/domains";
import type {
  BaseVO,
  ChangeRequestVO,
  NodeVO,
  OperationKind,
  OperationVO,
  RecordVO,
} from "busabase-contract/types";
import { iStringParse, iStringSchema } from "openlib/i18n/i-string";
import { type CoreI18nMessages, fmt } from "../../../i18n";
import { fieldPreviewText } from "./field";
import { fieldValueToString, shortIdentifier } from "./format";

// A commit's `name` may be a multilingual field name (iString record) — resolve
// it to a display string instead of JSON-stringifying it into the title.
const nameToString = (value: unknown): string => {
  const parsed = iStringSchema.safeParse(value);
  return parsed.success ? iStringParse(parsed.data) : fieldValueToString(value);
};

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

export const changeRequestStatusLabel = (status: string, messages?: CoreI18nMessages) => {
  if (status === "in_review") {
    return messages?.status.inReview ?? "In review";
  }
  if (status === "changes_requested") {
    return messages?.status.changesRequested ?? "Changes requested";
  }
  if (status === "conflict") {
    return messages?.status.conflict ?? "Conflict";
  }
  if (status === "rejected" || status === "abandoned") {
    return messages?.status.closed ?? "Closed";
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
  "drive_file_create",
  "drive_file_update",
  "drive_file_delete",
  "drive_metadata_update",
];

// Operation labels/tones come from the node-type registry (single source of truth).
export const operationMeta = OPERATION_META;

const getFieldString = (fields: Record<string, unknown>, key: string) => {
  const value = fields[key];
  return typeof value === "string" ? value : "";
};

export const getNodeOperationTypeLabel = (operation: OperationVO | null | undefined) => {
  if (!operation?.operation.startsWith("node_")) {
    return "";
  }

  const fields = operation.headCommit.fields;
  const nodeType = getFieldString(fields, "nodeType");
  return nodeType ? (getNodeType(nodeType)?.label ?? nodeType) : "";
};

export const getOperationLabel = (operation: OperationVO | null | undefined) => {
  if (!operation) {
    return "";
  }

  if (operation.operation.startsWith("node_")) {
    const nodeTypeLabel = getNodeOperationTypeLabel(operation);
    if (nodeTypeLabel) {
      const action = operation.operation.replace(/^node_/, "");
      return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${nodeTypeLabel.toLowerCase()}`;
    }
  }

  return operationMeta[operation.operation].label;
};

export const getChangeRequestScopeName = (changeRequest: ChangeRequestVO) =>
  changeRequest.base?.name ?? changeRequest.node?.name ?? "Node tree";

export const getNodeHref = (node: NodeVO | null | undefined) => {
  if (!node) {
    return null;
  }
  if (node.type === "skill" || node.type === "drive") {
    return `/${node.type}/${node.slug}`;
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

export const getOperationTargetLabel = (operation: OperationVO, messages?: CoreI18nMessages) => {
  if (operation.operation.startsWith("view_")) {
    return messages?.common.open ? `${messages.common.open} view` : "Open view";
  }
  if (operation.targetType === "node") {
    return messages?.common.open ? `${messages.common.open} node` : "Open node";
  }
  return messages?.common.open
    ? `${messages.common.open} ${messages.common.record}`
    : "Open record";
};

// Human-readable subject of an operation. For record operations the subject is
// the value of the base's PRIMARY field (first by position — same convention as
// getRecordTitle), read from the head commit or, for updates/deletes that don't
// touch it, from the "before" values. Falls back to a title/name/subject slug
// guess (views and nodes carry their name there) or the skill file path.
// Empty string when the operation has no meaningful name.
export const getOperationSubject = (operation: OperationVO, base?: BaseVO | null) => {
  if (base && operation.operation.startsWith("record_")) {
    const primaryField = base.fields[0];
    if (primaryField) {
      const subject =
        fieldPreviewText(operation.headCommit.fields[primaryField.slug], primaryField.type) ||
        (operation.baseFields
          ? fieldPreviewText(operation.baseFields[primaryField.slug], primaryField.type)
          : "");
      if (subject) {
        return subject;
      }
    }
  }

  const guessed =
    fieldValueToString(operation.headCommit.fields.title) ||
    nameToString(operation.headCommit.fields.name) ||
    fieldValueToString(operation.headCommit.fields.subject);
  if (guessed) {
    return guessed;
  }

  if (operation.operation.includes("_file_") && operation.filePath) {
    return operation.filePath;
  }

  return "";
};

export const getOperationTitle = (
  operation: OperationVO | null | undefined,
  base?: BaseVO | null,
) => {
  if (!operation) {
    return "";
  }

  const subject = getOperationSubject(operation, base);
  if (subject) {
    return subject;
  }

  return `${getOperationLabel(operation)} ${shortIdentifier(
    operation.targetRecordId ??
      operation.sourceRecordId ??
      operation.targetViewId ??
      operation.mergedViewId ??
      operation.headCommitId,
  )}`;
};

// Commit messages the API fills in when the author didn't write one. Pure
// boilerplate for a reviewer, so the UI hides them (see the input schema
// defaults in busabase-contract).
const DEFAULT_COMMIT_MESSAGES = new Set([
  "Initial change request",
  "Initial changeRequest",
  "Update node tree",
  "Delete record",
  "Revise operation",
  "Update skill",
  "Update drive",
  "Update doc",
  "Create view",
  "Update view",
  "Delete view",
  "Restore view",
  "Add field",
]);

// The author's own explanation of an operation (its commit message), when it
// says more than a system default.
export const getOperationMessage = (operation: OperationVO | null | undefined) => {
  const message = operation?.headCommit.message.trim() ?? "";
  return message && !DEFAULT_COMMIT_MESSAGES.has(message) ? message : "";
};

export const getChangeRequestMessage = (changeRequest: ChangeRequestVO) =>
  getOperationMessage(changeRequest.primaryOperation);

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

// Conventional-commit-style title: "<operation verb> <subject>", e.g.
// "Create Alice Johnson" or "Update view Weekly board" — never a bare commit id.
export const getChangeRequestTitle = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) => {
  if (changeRequest.operationCount > 1) {
    return `${changeRequest.operationCount} ${messages?.activity.operation ?? "operation"} ${messages?.activity.changeRequest ?? "change request"}`;
  }

  const operation = changeRequest.primaryOperation;
  if (!operation) {
    return `Untitled ${messages?.activity.changeRequest ?? "change request"}`;
  }

  const subject = getOperationSubject(operation, changeRequest.base);
  if (subject) {
    return `${operationMeta[operation.operation].label} ${subject}`;
  }

  return getOperationTitle(operation, changeRequest.base);
};

export const getChangeRequestSummary = (
  changeRequest: ChangeRequestVO,
  _messages?: CoreI18nMessages,
) => {
  const operationIndexes = new Map(operationOrder.map((operation, index) => [operation, index]));
  const counts = changeRequest.operations.reduce((items, operation) => {
    const label = getOperationLabel(operation).toLowerCase();
    const current = items.get(label) ?? {
      count: 0,
      order: operationIndexes.get(operation.operation) ?? operationOrder.length,
    };
    items.set(label, { ...current, count: current.count + 1 });
    return items;
  }, new Map<string, { count: number; order: number }>());
  const parts = [...counts.entries()]
    .sort((first, second) => first[1].order - second[1].order || first[0].localeCompare(second[0]))
    .map(([label, item]) => `${item.count} ${label}`);

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return `${changeRequest.operationCount} item${changeRequest.operationCount === 1 ? "" : "s"}`;
};

export const getChangeRequestOperationLabel = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) =>
  fmt("{count} {operation}{plural}", {
    count: changeRequest.operationCount,
    operation: messages?.activity.operation ?? "operation",
    plural: changeRequest.operationCount === 1 ? "" : "s",
  });

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
        if (field?.type === "json") {
          hints.add("JSON");
        }
        if (field?.type === "yaml") {
          hints.add("YAML");
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

export const getChangeRequestBrief = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) => {
  const scope = getChangeRequestScopeName(changeRequest);
  const summary = getChangeRequestSummary(changeRequest, messages);
  const risks = getChangeRequestRiskHints(changeRequest);
  const riskText = risks.length > 0 ? ` Watch ${risks.join(" and ")} changes.` : "";
  return `${getChangeRequestOperationLabel(changeRequest, messages)} in ${scope}: ${summary}.${riskText}`;
};

export const getChangeRequestReviewMessage = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) => {
  if (changeRequest.status === "approved") {
    return messages?.review.approvedReadyToMerge ?? "Approved · ready to merge";
  }
  if (changeRequest.status === "changes_requested") {
    return messages?.review.changesRequestedAwaiting ?? "Changes requested · awaiting revision";
  }
  if (changeRequest.status === "rejected" || changeRequest.status === "abandoned") {
    return messages?.review.statusClosed ?? "Closed";
  }
  if (changeRequest.status === "merged") {
    return messages?.review.mergedIntoBase ?? "Merged into Base";
  }
  return messages?.review.waitingForReview ?? "Waiting for your review";
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
  if (operation.operation.includes("_file_")) {
    return `${getOperationLabel(operation)} ${operation.filePath ?? "file"}`;
  }
  if (operation.operation === "node_create") {
    const nodeTypeLabel = getNodeOperationTypeLabel(operation).toLowerCase() || "node";
    return `Creates ${nodeTypeLabel}`;
  }
  if (operation.operation.startsWith("node_")) {
    return `${getOperationLabel(operation)} ${shortIdentifier(operation.nodeId)}`;
  }
  return `${getOperationLabel(operation)} ${shortIdentifier(operation.nodeId)}`;
};

export const isDerivedFieldSlug = (name: string, slug: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") === slug;
