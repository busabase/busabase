export type FieldType =
  | "text"
  | "longtext"
  | "markdown"
  | "html"
  | "attachment"
  | "relation"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multiselect"
  | "url"
  | "email"
  | "phone"
  | "created_time"
  | "updated_time"
  | "created_by"
  | "updated_by"
  | "auto_number"
  | "ai_summary"
  | "ai_tags"
  | "code";

// OperationKind + NodeType are owned by the node-type registry (single source of truth).
import type { NodeType, OperationKind } from "../domains/registry";
export type { NodeType, OperationKind };
export type ChangeRequestStatus =
  | "in_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "merged"
  | "abandoned"
  | "conflict";
export type OperationStatus = "pending" | "merged" | "archived" | "failed";
export type ChangeRequestTargetType = "base" | "node";
export type ReviewVerdict = "approved" | "rejected";
export type SearchResultKind = "record" | "change_request" | "base";
export type CommentSubjectType = "record" | "change_request" | "operation" | "commit";
export type AuditAction =
  | "record.viewed"
  | "change_request.created"
  | "change_request.updated"
  | "change_request.deleted"
  | "change_request.reviewed"
  | "change_request.merged"
  // Direct (non-change-request) mutations — keep in sync with the contract's
  // auditActionSchema (contract/schemas.ts) and the core auditEventInputSchema.
  | "base.created"
  | "field.created"
  | "doc.created"
  | "doc.updated"
  | "skill.created"
  | "asset.deleted"
  | "node.purged";

export interface NodeVO {
  id: string;
  parentId: string | null;
  type: NodeType;
  slug: string;
  name: string;
  description: string;
  metadata: {
    storagePrefix?: string;
    entryFile?: string;
    visibility?: "private" | "workspace" | "public";
    version?: string;
  };
  position: number;
  createdAt: string;
  updatedAt: string;
  baseId: string | null;
  children: NodeVO[];
}

// Attachment field values are stored as AttachmentRef[]; re-exported for the public barrel
// so clients can type a record's attachment-field value without importing open-domains.
export type { AttachmentRef } from "open-domains/attachments/types";

// Base-domain VOs live in the base domain; re-exported here for the public barrel.
import type { BaseVO } from "../domains/base/types";

export type {
  BaseFieldVO,
  BaseVO,
  RecordLinkVO,
  RecordVO,
  ViewConfigVO,
  ViewFilterOperator,
  ViewFilterVO,
  ViewSortVO,
  ViewVO,
} from "../domains/base/types";

export interface CommitVO {
  id: string;
  baseId: string | null;
  targetType: ChangeRequestTargetType;
  nodeId: string | null;
  operationId: string | null;
  parentCommitId: string | null;
  fields: Record<string, unknown>;
  operation: OperationKind;
  message: string;
  author: string;
  createdAt: string;
}

export interface OperationVO {
  id: string;
  changeRequestId: string;
  baseId: string | null;
  targetType: ChangeRequestTargetType;
  nodeId: string | null;
  operation: OperationKind;
  status: OperationStatus;
  targetRecordId: string | null;
  targetViewId: string | null;
  filePath: string | null;
  sourceRecordId: string | null;
  sourceCommitId: string | null;
  baseCommitId: string | null;
  headCommitId: string;
  deleteMode: "archive";
  mergedRecordId: string | null;
  mergedViewId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  headCommit: CommitVO;
  // Canonical "before" values for a true before → after diff. Null for creations
  // and kinds without a field-map prior state (e.g. skill files). See operationSchema.
  baseFields: Record<string, unknown> | null;
}

export interface ChangeRequestVO {
  id: string;
  baseId: string | null;
  targetType: ChangeRequestTargetType;
  nodeId: string | null;
  status: ChangeRequestStatus;
  submittedBy: string;
  sourceMeta: Record<string, unknown>;
  reviewPolicySnapshot: Record<string, unknown>;
  mergeSummary: Record<string, unknown>;
  rejectedReason: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  base: BaseVO | null;
  node: NodeVO | null;
  operations: OperationVO[];
  primaryOperation: OperationVO | null;
  operationCount: number;
  reviews: ReviewVO[];
}

// Skill-domain VOs live in the skill domain; re-exported here for the public barrel.
export type { SkillFileVO, SkillVO } from "../domains/skill/types";

export interface ReviewVO {
  id: string;
  changeRequestId: string;
  reviewerId: string;
  verdict: ReviewVerdict;
  reason: string | null;
  visibleOperationHeads: Record<string, string>;
  createdAt: string;
}

export interface CommentVO {
  id: string;
  subjectType: CommentSubjectType;
  subjectId: string;
  recordId: string | null;
  changeRequestId: string | null;
  operationId: string | null;
  commitId: string | null;
  authorId: string;
  body: string;
  mentionsAi: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskVO {
  changeRequest: ChangeRequestVO;
  trigger: "changes_requested" | "ai_mention";
  reviewReason: string | null;
  aiComments: CommentVO[];
}

export interface SearchResultVO {
  id: string;
  kind: SearchResultKind;
  title: string;
  body: string;
  eyebrow: string;
  href: string;
  updatedAt: string | null;
}

export interface SearchResponseVO {
  query: string;
  limit: number;
  offset: number;
  hasMore: boolean;
  results: SearchResultVO[];
}

export interface AuditEventVO {
  id: string;
  action: AuditAction;
  actorId: string;
  baseId: string | null;
  recordId: string | null;
  changeRequestId: string | null;
  operationId: string | null;
  commitId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
