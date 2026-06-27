// View objects owned by the base domain (structured records + views).
import type { CommitVO, FieldType } from "../../types";

export interface BaseFieldVO {
  id: string;
  baseId: string;
  slug: string;
  name: string;
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
  operator: ViewFilterOperator;
  value?: unknown;
}

export interface ViewSortVO {
  direction: "asc" | "desc";
  fieldSlug: string;
}

export interface ViewConfigVO {
  filters: ViewFilterVO[];
  sorts: ViewSortVO[];
  visibleFieldSlugs?: string[] | null;
}

export interface ViewVO {
  id: string;
  baseId: string;
  slug: string;
  name: string;
  description: string;
  type: "table";
  config: ViewConfigVO;
  status: "active" | "archived";
  createdBy: string;
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
