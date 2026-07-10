import "server-only";

import type {
  AuditAction,
  AuditEventVO,
  BaseFieldVO,
  BaseVO,
  CommentSubjectType,
  CommentVO,
  CommitVO,
  FieldType,
  NodeVO,
  OperationKind,
  OperationStatus,
  OperationVO,
  RecordLinkVO,
  ReviewVO,
  UserRefVO,
  ViewConfigVO,
  ViewFilterVO,
  ViewSortVO,
  ViewVO,
} from "busabase-contract/types";
import { iStringFromText } from "openlib/i18n/i-string";
import type {
  AuditEventPO,
  BaseFieldPO,
  BasePO,
  CommentPO,
  CommitPO,
  NodePO,
  OperationPO,
  RecordLinkPO,
  ReviewPO,
  ViewPO,
} from "../db/schema";

export const toIso = (date: Date | null) => (date ? date.toISOString() : null);

export type UserRefMap = Map<string, UserRefVO>;

const userRef = (users: UserRefMap | undefined, userId: string): UserRefVO | null =>
  users?.get(userId) ?? null;

const VALUE_TEXT_INDEX_LIMIT = 1024;
const JSON_LIKE_FIELD_TYPES = new Set<FieldType>(["json", "attachment", "relation"]);
const DATE_FIELD_TYPES = new Set<FieldType>(["date", "created_time", "updated_time"]);

const trimIndexText = (value: string) =>
  value.length > VALUE_TEXT_INDEX_LIMIT ? value.slice(0, VALUE_TEXT_INDEX_LIMIT) : value;

const parseJsonString = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const normalizeFieldValue = (value: unknown, fieldType?: FieldType) => {
  if (value === null || value === undefined) {
    return {};
  }
  if (fieldType && JSON_LIKE_FIELD_TYPES.has(fieldType)) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    return {
      valueText: null,
      valueJson: typeof value === "string" ? parseJsonString(value) : value,
      valueHash:
        serialized.length > 256 ? `${serialized.length}:${serialized.slice(0, 128)}` : null,
    };
  }
  if (typeof value === "string") {
    const maybeDate = DATE_FIELD_TYPES.has(fieldType as FieldType) ? new Date(value) : null;
    return {
      valueText: trimIndexText(value),
      valueDate: maybeDate && !Number.isNaN(maybeDate.getTime()) ? maybeDate : null,
      valueHash: value.length > 256 ? `${value.length}:${value.slice(0, 128)}` : null,
    };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { valueText: String(value), valueNumber: value };
  }
  if (typeof value === "boolean") {
    return { valueText: String(value), valueBool: value };
  }

  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  return {
    valueText: Array.isArray(value) ? trimIndexText(value.join(", ")) : null,
    valueJson: value,
    valueHash: serialized.slice(0, 256),
  };
};

export const toFieldVO = (field: BaseFieldPO): BaseFieldVO => ({
  id: field.id,
  baseId: field.baseId,
  slug: field.slug,
  // The text column stores locale-record names JSON-encoded (see iStringToText
  // at the write sites); plain-string names pass through untouched.
  name: iStringFromText(field.name),
  type: field.type as FieldType,
  required: field.required,
  position: field.position,
  options: field.options ?? {},
});

export const toBaseVO = (base: BasePO, fields: BaseFieldPO[]): BaseVO => ({
  id: base.id,
  nodeId: base.nodeId,
  slug: base.slug,
  name: base.name,
  description: base.description,
  reviewPolicy: base.reviewPolicy,
  createdAt: base.createdAt.toISOString(),
  fields: fields.sort((a, b) => a.position - b.position).map(toFieldVO),
});

export const normalizeViewConfig = (config: ViewPO["config"] | ViewConfigVO): ViewConfigVO => ({
  filters: (config.filters ?? []) as ViewFilterVO[],
  sorts: (config.sorts ?? []) as ViewSortVO[],
  visibleFieldSlugs: config.visibleFieldSlugs,
});

export const toViewVO = (view: ViewPO, users?: UserRefMap): ViewVO => ({
  id: view.id,
  baseId: view.baseId,
  slug: view.slug,
  name: view.name,
  description: view.description,
  type: "table",
  config: normalizeViewConfig(view.config),
  status: view.status === "archived" ? "archived" : "active",
  createdBy: view.createdBy,
  createdByUser: userRef(users, view.createdBy),
  archivedAt: toIso(view.archivedAt),
  createdAt: view.createdAt.toISOString(),
  updatedAt: view.updatedAt.toISOString(),
});

export const toNodeVO = (node: NodePO, baseId: string | null, children: NodeVO[] = []): NodeVO => ({
  id: node.id,
  parentId: node.parentId,
  type: node.type,
  slug: node.slug,
  name: node.name,
  description: node.description,
  metadata: node.metadata ?? {},
  position: node.position,
  createdAt: node.createdAt.toISOString(),
  updatedAt: node.updatedAt.toISOString(),
  baseId,
  children,
});

export const toRecordLinkVO = (link: RecordLinkPO): RecordLinkVO => ({
  id: link.id,
  baseId: link.baseId,
  fieldId: link.fieldId,
  fieldSlug: link.fieldSlug,
  sourceRecordId: link.sourceRecordId,
  targetBaseId: link.targetBaseId,
  targetRecordId: link.targetRecordId,
  commitId: link.commitId,
  position: link.position,
  createdAt: link.createdAt.toISOString(),
  updatedAt: link.updatedAt.toISOString(),
});

export const toCommitVO = (commit: CommitPO, users?: UserRefMap): CommitVO => ({
  id: commit.id,
  baseId: commit.baseId,
  targetType: commit.targetType,
  nodeId: commit.nodeId,
  operationId: commit.operationId,
  parentCommitId: commit.parentCommitId,
  fields: commit.fields,
  operation: commit.operation as OperationKind,
  message: commit.message,
  author: commit.author,
  authorUser: userRef(users, commit.author),
  createdAt: commit.createdAt.toISOString(),
});

export const toReviewVO = (review: ReviewPO, users?: UserRefMap): ReviewVO => ({
  id: review.id,
  changeRequestId: review.changeRequestId,
  reviewerId: review.reviewerId,
  reviewer: userRef(users, review.reviewerId),
  verdict: review.verdict,
  reason: review.reason,
  visibleOperationHeads: review.visibleOperationHeads,
  createdAt: review.createdAt.toISOString(),
});

export const toCommentVO = (comment: CommentPO, users?: UserRefMap): CommentVO => ({
  id: comment.id,
  subjectType: comment.subjectType as CommentSubjectType,
  subjectId: comment.subjectId,
  recordId: comment.recordId,
  changeRequestId: comment.changeRequestId,
  operationId: comment.operationId,
  commitId: comment.commitId,
  authorId: comment.authorId,
  author: userRef(users, comment.authorId),
  body: comment.body,
  mentionsAi: comment.mentionsAi,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
});

export const toAuditEventVO = (event: AuditEventPO, users?: UserRefMap): AuditEventVO => ({
  id: event.id,
  action: event.action as AuditAction,
  actorId: event.actorId,
  actor: userRef(users, event.actorId),
  baseId: event.baseId,
  recordId: event.recordId,
  changeRequestId: event.changeRequestId,
  operationId: event.operationId,
  commitId: event.commitId,
  metadata: event.metadata,
  createdAt: event.createdAt.toISOString(),
});

export const toOperationVO = (
  item: OperationPO,
  headCommit: CommitPO,
  baseFields: Record<string, unknown> | null,
  users?: UserRefMap,
): OperationVO => ({
  id: item.id,
  changeRequestId: item.changeRequestId,
  baseId: item.baseId,
  targetType: item.targetType,
  nodeId: item.nodeId,
  operation: item.operation as OperationKind,
  status: item.status as OperationStatus,
  targetRecordId: item.targetRecordId,
  targetViewId: item.targetViewId,
  filePath: item.filePath,
  sourceRecordId: item.sourceRecordId,
  sourceCommitId: item.sourceCommitId,
  baseCommitId: item.baseCommitId,
  headCommitId: item.headCommitId,
  deleteMode: "archive",
  mergedRecordId: item.mergedRecordId,
  mergedViewId: item.mergedViewId,
  position: item.position,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  headCommit: toCommitVO(headCommit, users),
  baseFields,
});
