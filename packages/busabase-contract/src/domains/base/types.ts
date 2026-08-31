// View objects owned by the base domain (structured records + views).
import type { AttachmentRef } from "open-domains/attachments/types";
import type { iString } from "openlib/i18n/i-string";
import type { CommitVO, FieldType, LookupRollup, UserRefVO } from "../../types";

export interface AssetAttachmentRef extends AttachmentRef {
  attachmentId: string;
  assetId?: string;
}

export interface BaseFieldVO {
  id: string;
  baseId: string;
  slug: string;
  /**
   * Display name — a plain string or a locale-keyed record
   * (e.g. { en: "Company", "zh-CN": "公司" }). Resolve with iStringParse.
   */
  name: iString;
  type: FieldType;
  required: boolean;
  position: number;
  options: {
    ai?: {
      model?: string;
      prompt?: string;
      reviewRequired?: boolean;
      sourceFieldIds?: string[];
    };
    attachment?: {
      maxFiles?: number;
      allowedMimeTypes?: string[];
      maxFileSize?: number;
    };
    choices?: Array<{
      color?: string;
      id: string;
      name: string;
    }>;
    code?: {
      language?: string;
    };
    embed?: {
      aspectRatio?: "16:9" | "4:3" | "1:1";
      height?: number;
      providers?: string[];
    };
    // Must mirror the contract's fieldOptionsSchema — see base-schemas.ts there.
    formula?: {
      expression: string;
    };
    inverseFieldId?: string;
    // Must mirror the contract's fieldOptionsSchema — see base-schemas.ts there.
    lookup?: {
      relationFieldSlug: string;
      targetFieldSlug: string;
      rollup?: LookupRollup;
      limit?: "all" | "first";
    };
    multiple?: boolean;
    targetBaseId?: string;
    number?: {
      format?: "plain" | "currency";
      currency?: string;
      locale?: string;
    };
  };
}

export interface BaseVO {
  id: string;
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  reviewPolicy: {
    kind: "single";
    requiredApprovals: number;
  };
  createdAt: string;
  fields: BaseFieldVO[];
  /**
   * The owning node's own `metadata` (from `busabase_nodes.metadata`, NOT a
   * `busabase_bases` column) — carried here so a Base-only caller (e.g. the
   * Agent Prompts dialog reached from `BaseDetailHeader`, which only has a
   * `BaseVO` on hand) can read `metadata.agentPrompts` the same way every
   * other node type's `NodeVO.metadata` already does. Kept as
   * `Record<string, unknown>` to match `NodeVO.metadata` and
   * `NodePromptContext.metadata` rather than inventing a narrower type.
   */
  metadata: Record<string, unknown>;
}

export type ViewFilterOperator =
  | "contains"
  | "equals"
  | "not_empty"
  | "is_empty"
  | "is_true"
  | "is_false";

export interface ViewFilterVO {
  fieldSlug: string;
  fieldId?: string;
  operator: ViewFilterOperator;
  value?: unknown;
}

export interface ViewSortVO {
  direction: "asc" | "desc";
  fieldSlug: string;
  fieldId?: string;
}

export type ViewType = "table" | "gallery" | "kanban" | "calendar" | "gantt";
export type GalleryCoverFit = "cover" | "fit";
export type GalleryCardSize = "small" | "medium" | "large";
export type GanttScale = "week" | "month";

export const VIEW_FIELD_MIN_WIDTH = 92;
export const VIEW_FIELD_MAX_WIDTH = 640;

export interface ViewConfigVO {
  filters: ViewFilterVO[];
  sorts: ViewSortVO[];
  visibleFieldSlugs?: string[] | null;
  /** Table-only column widths in pixels, keyed by field slug. */
  fieldWidths?: Record<string, number>;
  // Gallery-only presentation config (see view-schemas.ts).
  coverFieldSlug?: string | null;
  coverFit?: GalleryCoverFit;
  cardSize?: GalleryCardSize;
  showFieldLabels?: boolean;
  // Kanban-only: single-select field that stacks records into columns.
  stackByFieldSlug?: string | null;
  // Calendar-only: date field that positions records on the month grid.
  dateFieldSlug?: string | null;
  // Gantt-only: start/end date fields bounding each bar + axis granularity.
  startFieldSlug?: string | null;
  endFieldSlug?: string | null;
  ganttScale?: GanttScale;
}

export interface ViewVO {
  id: string;
  baseId: string;
  slug: string;
  name: string;
  description: string;
  type: ViewType;
  config: ViewConfigVO;
  status: "active" | "archived";
  createdBy: string;
  createdByUser?: UserRefVO | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordVO {
  id: string;
  baseId: string;
  headCommitId: string;
  parentRecordId: string | null;
  parentCommitId: string | null;
  status: "active" | "archived";
  createdBy: string;
  createdByUser?: UserRefVO | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  base: BaseVO;
  headCommit: CommitVO;
}

export interface RecordLinkVO {
  id: string;
  baseId: string;
  fieldId: string;
  fieldSlug: string;
  sourceRecordId: string;
  targetBaseId: string;
  targetRecordId: string;
  commitId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}
