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
  | "embed"
  | "email"
  | "phone"
  | "created_time"
  | "updated_time"
  | "created_by"
  | "updated_by"
  | "auto_number"
  | "ai_summary"
  | "ai_tags"
  | "code"
  | "json"
  | "yaml"
  | "formula"
  | "lookup"
  | "whiteboard";

/** Rollup functions a `lookup` field can apply — mirrors `lookupRollupSchema`. */
export type LookupRollup = "values" | "count" | "sum" | "average" | "min" | "max" | "concatenate";

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
export type SearchResultKind = "record" | "change_request" | "base" | "file";
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
  | "file.created"
  | "skill.created"
  | "drive.created"
  | "airapp.created"
  | "asset.deleted"
  | "asset.metadata_updated"
  | "asset.text_written"
  | "asset.text_marked_none"
  | "node.metadata_updated"
  | "node.purged";

export interface UserRefVO {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role?: string | null;
}

/**
 * Cheap, name/slug-only match from `nodes.searchByName` — deliberately a much
 * smaller projection than `NodeVO` (no `description`/`metadata`/tree shape):
 * this backs the dashboard's instant quick-jump palette, not the sidebar tree
 * or a node's own detail view. `path` is the route this node navigates to
 * (e.g. `/base/{slug}`), not a filesystem/breadcrumb tree path.
 */
export interface NodeSearchResultVO {
  id: string;
  type: NodeType;
  name: string;
  slug: string;
  path: string;
  updatedAt: string;
}

export interface NodeVO {
  id: string;
  parentId: string | null;
  type: NodeType;
  slug: string;
  name: string;
  description: string;
  /**
   * Free-form extension data — the caller's bag. The product reads nothing here
   * except `version`, a label the user writes and the product never interprets.
   * Kept in sync with `NodeOutput` in `contract/schemas.ts`, which is the shape
   * the wire schema actually validates.
   */
  metadata: Record<string, unknown> & {
    version?: string;
  };
  /**
   * This node's OWN declared visibility, or null when it inherits from its
   * ancestors. A real column rather than a metadata key, because it is the node
   * ACL's only explicit input — see `content/spec/node-content-storage.md` (D1).
   */
  explicitVisibility: "private" | "workspace" | "public" | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  baseId: string | null;
  children: NodeVO[];
  /**
   * Whether this node has children beyond what `children` carries — see the
   * matching field on the contract's `NodeOutput` (contract/schemas.ts) for
   * the full depth-boundary explanation. Optional/omitted is safe to treat
   * as `children.length > 0`.
   */
  hasChildren?: boolean;
}

// Keep the plain open-domains `AttachmentRef` available for lower-level file
// upload surfaces that are not part of the Busabase Assets library.
export type { AttachmentRef } from "open-domains/attachments/types";
// `attachment` base field values are stored as asset-backed refs: `id` is the
// stable asset id while `attachmentId` points at the underlying file registry row.
export type { AssetAttachmentRef } from "../domains/base/types";

// Base-domain VOs live in the base domain; re-exported here for the public barrel.
import type { BaseVO, RecordVO, ViewVO } from "../domains/base/types";

export type {
  BaseFieldVO,
  BaseVO,
  GalleryCardSize,
  GalleryCoverFit,
  GanttScale,
  RecordLinkVO,
  RecordVO,
  ViewConfigVO,
  ViewFilterOperator,
  ViewFilterVO,
  ViewSortVO,
  ViewType,
  ViewVO,
} from "../domains/base/types";
export { VIEW_FIELD_MAX_WIDTH, VIEW_FIELD_MIN_WIDTH } from "../domains/base/types";

export type {
  CreateFormDTO,
  FormBoundFieldVO,
  FormFieldBindingVO,
  FormPageSourceVO,
  FormShareVO,
  FormSubmitResultVO,
  FormThemeVO,
  FormVO,
  ListFormsDTO,
  ListFormsVO,
  SubmitFormDTO,
  UpdateFormDTO,
} from "../domains/form/types";

export interface CommitVO {
  id: string;
  baseId: string | null;
  targetType: ChangeRequestTargetType;
  nodeId: string | null;
  operationId: string | null;
  parentCommitId: string | null;
  /**
   * Polymorphic change payload; its shape is determined by `operation`.
   * Intentionally loose here — see the comment on `commitSchema.payload` in
   * `contract/schemas.ts`. Historical commits predate payload validation, and this
   * VO is what history/approval screens read, so it must stay permissive.
   */
  payload: Record<string, unknown>;
  operation: OperationKind;
  message: string;
  author: string;
  authorUser?: UserRefVO | null;
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
  submittedByUser?: UserRefVO | null;
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

export interface ChangeRequestBatchFailureVO {
  changeRequestId: string;
  ok: false;
  error: string;
  code?: string;
  data?: unknown;
}

export interface ChangeRequestReviewBatchResultVO {
  results: Array<
    | {
        changeRequestId: string;
        ok: true;
        status: string;
        changeRequest: ChangeRequestVO;
      }
    | ChangeRequestBatchFailureVO
  >;
}

export interface ChangeRequestMergeBatchResultVO {
  results: Array<
    | {
        changeRequestId: string;
        ok: true;
        status: string;
        changeRequest: ChangeRequestVO;
        record: RecordVO | null;
        view: ViewVO | null;
      }
    | ChangeRequestBatchFailureVO
  >;
}

// Whole-space inbox tab counts (not a capped page) — one number per inbox tab.
export interface ChangeRequestCountsVO {
  review: number;
  changes: number;
  created: number;
  approved: number;
  merged: number;
  rejected: number;
}

// Activity-feed descriptor (discriminated union) — inferred from its zod schema.
export type { ActivityItemVO } from "../contract/activity-schemas";
// The discriminated output of the unified `nodes.get` — one typed detail for
// every node type, replacing the retired per-type get VOs' role as an API
// return type. The per-type VOs below are still each variant's payload.
export type { NodeDetailVO } from "../contract/node-detail-schemas";
// AirApp-domain VOs live in the airapp domain; re-exported here for the public barrel.
export type { AirAppFileVO, AirAppReadFileVO, AirAppVO } from "../domains/airapp/types";
export type {
  AssetDetailVO,
  AssetTextStatus,
  AssetUsageVO,
  AssetVO,
} from "../domains/assets/types";
export type { DriveFileVO, DriveReadFileVO, DriveVO } from "../domains/drive/types";
export type { FileNodeMetadata, FileNodeVO } from "../domains/file-node/types";
export type { FileTreeFileVO, FileTreeNodeVO, FileTreeReadFileVO } from "../domains/filetree/types";
// Skill-domain VOs live in the skill domain; re-exported here for the public barrel.
export type { SkillFileVO, SkillReadFileVO, SkillVO } from "../domains/skill/types";
export type {
  UpdateVaultSettingsDTO,
  VaultAccessPolicy,
  VaultEnvironment,
  VaultItemInput,
  VaultItemKind,
  VaultItemVO,
  VaultRuntimeEnv,
  VaultScopeType,
  VaultSettingsVO,
} from "../domains/vault/types";

export interface ReviewVO {
  id: string;
  changeRequestId: string;
  reviewerId: string;
  reviewer?: UserRefVO | null;
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
  author?: UserRefVO | null;
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
  actor?: UserRefVO | null;
  baseId: string | null;
  recordId: string | null;
  changeRequestId: string | null;
  operationId: string | null;
  commitId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
