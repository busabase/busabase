// View objects owned by the base domain (structured records + views).
import type { AttachmentRef } from "open-domains/attachments/types";
import type { iString } from "openlib/i18n/i-string";
import type { CommitVO, FieldType, UserRefVO } from "../../types";

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
    inverseFieldId?: string;
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

export interface ViewConfigVO {
  filters: ViewFilterVO[];
  sorts: ViewSortVO[];
  visibleFieldSlugs?: string[] | null;
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
