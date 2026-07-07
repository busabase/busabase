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

const operationLabelKeys: Record<OperationKind, keyof CoreI18nMessages["operation"]> = {
  drive_file_create: "driveFileCreate",
  drive_file_delete: "driveFileDelete",
  drive_file_update: "driveFileUpdate",
  drive_metadata_update: "driveMetadataUpdate",
  node_create: "nodeCreate",
  node_delete: "nodeDelete",
  node_move: "nodeMove",
  node_rename: "nodeRename",
  node_restore: "nodeRestore",
  base_add_field: "baseAddField",
  base_archive: "baseArchive",
  base_convert_field: "baseConvertField",
  base_delete_field: "baseDeleteField",
  base_reorder_fields: "baseReorderFields",
  base_restore: "baseRestore",
  base_restore_field: "baseRestoreField",
  base_update_field: "baseUpdateField",
  doc_update: "docUpdate",
  record_create: "recordCreate",
  record_delete: "recordDelete",
  record_restore: "recordRestore",
  record_update: "recordUpdate",
  record_variant: "recordVariant",
  skill_file_create: "skillFileCreate",
  skill_file_delete: "skillFileDelete",
  skill_file_update: "skillFileUpdate",
  skill_metadata_update: "skillMetadataUpdate",
  view_create: "viewCreate",
  view_delete: "viewDelete",
  view_restore: "viewRestore",
  view_update: "viewUpdate",
};

const nodeActionLabelKeys: Record<string, keyof CoreI18nMessages["operation"]> = {
  create: "actionCreate",
  delete: "actionDelete",
  move: "actionMove",
  rename: "actionRename",
  restore: "actionRestore",
};

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

export const getOperationLabel = (
  operation: OperationVO | null | undefined,
  messages?: CoreI18nMessages,
) => {
  if (!operation) {
    return "";
  }

  if (operation.operation.startsWith("node_")) {
    const nodeTypeLabel = getNodeOperationTypeLabel(operation);
    if (nodeTypeLabel) {
      const action = operation.operation.replace(/^node_/, "");
      const actionLabel = messages
        ? messages.operation[nodeActionLabelKeys[action] ?? "actionMove"]
        : `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
      return `${actionLabel} ${nodeTypeLabel.toLowerCase()}`;
    }
  }

  return messages
    ? messages.operation[operationLabelKeys[operation.operation]]
    : operationMeta[operation.operation].label;
};

export const getChangeRequestScopeName = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) =>
  changeRequest.base?.name ??
  changeRequest.node?.name ??
  messages?.operation.nodeTree ??
  "Node tree";

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
    return messages?.operation.openView ?? "Open view";
  }
  if (operation.targetType === "node") {
    return messages?.operation.openNode ?? "Open node";
  }
  return messages?.operation.openRecord ?? "Open record";
};

// Human-readable subject of an operation. For record operations the subject is
// the value of the base's PRIMARY field (first by position — same convention as
// getRecordTitle), read from the head commit or, for updates/deletes that don't
// touch it, from the "before" values. Falls back to a title/name/subject slug
// guess (views and nodes carry their name there) or the skill file path.
// Empty string when the operation has no meaningful name.
export const getOperationSubject = (
  operation: OperationVO,
  base?: BaseVO | null,
  messages?: CoreI18nMessages,
) => {
  if (base && operation.operation.startsWith("record_")) {
    const primaryField = base.fields[0];
    if (primaryField) {
      const subject =
        fieldPreviewText(
          operation.headCommit.fields[primaryField.slug],
          primaryField.type,
          messages,
        ) ||
        (operation.baseFields
          ? fieldPreviewText(operation.baseFields[primaryField.slug], primaryField.type, messages)
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
  messages?: CoreI18nMessages,
) => {
  if (!operation) {
    return "";
  }

  const subject = getOperationSubject(operation, base, messages);
  if (subject) {
    return subject;
  }

  return `${getOperationLabel(operation, messages)} ${shortIdentifier(
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

export const getRecordTitle = (
  record: RecordVO | null | undefined,
  messages?: CoreI18nMessages,
) => {
  if (!record) {
    return messages?.common.record ?? "Record";
  }

  // The record title is the value of the base's PRIMARY field (its first field
  // by position — the Airtable/Baserow convention), not a hard-coded
  // title/name/subject guess. So a base whose first field is `name`, `title`,
  // or anything else displays correctly, and relation chips show that value.
  const primaryField = record.base.fields[0];
  const primary = primaryField
    ? fieldPreviewText(record.headCommit.fields[primaryField.slug], primaryField.type, messages)
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
    return messages
      ? fmt(messages.operation.multiOperationTitle, {
          changeRequest: messages.activity.changeRequest,
          count: changeRequest.operationCount,
          operation: messages.activity.operation,
        })
      : `${changeRequest.operationCount} operation change request`;
  }

  const operation = changeRequest.primaryOperation;
  if (!operation) {
    return messages
      ? fmt(messages.operation.untitledChangeRequest, {
          changeRequest: messages.activity.changeRequest,
        })
      : "Untitled change request";
  }

  const subject = getOperationSubject(operation, changeRequest.base, messages);
  if (subject) {
    return `${getOperationLabel(operation, messages)} ${subject}`;
  }

  return getOperationTitle(operation, changeRequest.base, messages);
};

export const getChangeRequestSummary = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) => {
  const operationIndexes = new Map(operationOrder.map((operation, index) => [operation, index]));
  const counts = changeRequest.operations.reduce((items, operation) => {
    const label = getOperationLabel(operation, messages).toLowerCase();
    const current = items.get(label) ?? {
      count: 0,
      order: operationIndexes.get(operation.operation) ?? operationOrder.length,
    };
    items.set(label, { ...current, count: current.count + 1 });
    return items;
  }, new Map<string, { count: number; order: number }>());
  const parts = [...counts.entries()]
    .sort((first, second) => first[1].order - second[1].order || first[0].localeCompare(second[0]))
    .map(([label, item]) =>
      messages
        ? fmt(messages.operation.summaryItem, { count: item.count, label })
        : `${item.count} ${label}`,
    );

  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return messages
    ? fmt(messages.operation.summaryFallback, {
        count: changeRequest.operationCount,
        item: changeRequest.operationCount === 1 ? messages.common.item : messages.common.items,
      })
    : `${changeRequest.operationCount} item${changeRequest.operationCount === 1 ? "" : "s"}`;
};

export const getChangeRequestOperationLabel = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) =>
  messages
    ? fmt(
        changeRequest.operationCount === 1
          ? messages.operation.operationCount
          : messages.operation.operationCountPlural,
        {
          count: changeRequest.operationCount,
          operation: messages.activity.operation,
        },
      )
    : fmt("{count} {operation}{plural}", {
        count: changeRequest.operationCount,
        operation: "operation",
        plural: changeRequest.operationCount === 1 ? "" : "s",
      });

export const getChangeRequestRiskHints = (
  changeRequest: ChangeRequestVO,
  messages?: CoreI18nMessages,
) => {
  const hints = new Set<string>();
  for (const operation of changeRequest.operations) {
    if (operation.operation.endsWith("_delete")) {
      hints.add(messages?.operation.destructive ?? "destructive");
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
          hints.add(messages?.operation.attachment ?? "attachment");
        }
        if (field?.type === "relation") {
          hints.add(messages?.operation.relation ?? "relation");
        }
        if (typeof value === "string" && value.length > 500) {
          hints.add(messages?.operation.longText ?? "long text");
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
  const scope = getChangeRequestScopeName(changeRequest, messages);
  const summary = getChangeRequestSummary(changeRequest, messages);
  const countLabel = getChangeRequestOperationLabel(changeRequest, messages);
  const risks = getChangeRequestRiskHints(changeRequest, messages);
  if (messages) {
    return risks.length > 0
      ? fmt(messages.operation.riskBrief, {
          countLabel,
          risks: risks.join(messages.operation.riskAnd),
          scope,
          summary,
        })
      : fmt(messages.operation.brief, { countLabel, scope, summary });
  }
  const riskText = risks.length > 0 ? ` Watch ${risks.join(" and ")} changes.` : "";
  return `${countLabel} in ${scope}: ${summary}.${riskText}`;
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

export const getOperationImpact = (operation: OperationVO, messages?: CoreI18nMessages) => {
  if (operation.operation === "record_create") {
    return messages?.operation.impactRecordCreate ?? "Adds a new record";
  }
  if (operation.operation === "record_update") {
    const id = shortIdentifier(operation.targetRecordId);
    return messages ? fmt(messages.operation.impactRecordUpdate, { id }) : `Updates ${id}`;
  }
  if (operation.operation === "record_delete") {
    const id = shortIdentifier(operation.targetRecordId);
    if (operation.deleteMode === "archive") {
      return messages ? fmt(messages.operation.impactRecordArchive, { id }) : `Archives ${id}`;
    }
    return messages ? fmt(messages.operation.impactRecordDelete, { id }) : `Deletes ${id}`;
  }
  if (operation.operation === "record_variant") {
    const id = shortIdentifier(operation.sourceRecordId);
    return messages ? fmt(messages.operation.impactRecordVariant, { id }) : `Variants ${id}`;
  }
  if (operation.operation === "view_create") {
    return messages?.operation.impactViewCreate ?? "Adds a new view";
  }
  if (operation.operation === "view_update") {
    const id = shortIdentifier(operation.targetViewId ?? operation.mergedViewId);
    return messages ? fmt(messages.operation.impactViewUpdate, { id }) : `Updates view ${id}`;
  }
  if (operation.operation === "view_delete") {
    const id = shortIdentifier(operation.targetViewId ?? operation.mergedViewId);
    return messages ? fmt(messages.operation.impactViewDelete, { id }) : `Deletes view ${id}`;
  }
  if (operation.operation.includes("_file_")) {
    const file = operation.filePath ?? "file";
    const label = getOperationLabel(operation, messages);
    return messages
      ? fmt(messages.operation.impactFile, { file, operation: label })
      : `${label} ${file}`;
  }
  if (operation.operation === "node_create") {
    const nodeTypeLabel = getNodeOperationTypeLabel(operation).toLowerCase() || "node";
    return messages
      ? fmt(messages.operation.impactNodeCreate, { nodeType: nodeTypeLabel })
      : `Creates ${nodeTypeLabel}`;
  }
  if (operation.operation.startsWith("node_")) {
    const id = shortIdentifier(operation.nodeId);
    const label = getOperationLabel(operation, messages);
    return messages
      ? fmt(messages.operation.impactNode, { id, operation: label })
      : `${label} ${id}`;
  }
  const id = shortIdentifier(operation.nodeId);
  const label = getOperationLabel(operation, messages);
  return messages ? fmt(messages.operation.impactNode, { id, operation: label }) : `${label} ${id}`;
};

export const isDerivedFieldSlug = (name: string, slug: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") === slug;
