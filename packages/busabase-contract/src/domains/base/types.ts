// View objects owned by the base domain (structured records + views).
import type { AttachmentRef } from "open-domains/attachments/types";
import type { iString } from "openlib/i18n/i-string";
import type { ApiKeyPermissionLevel } from "../../access-control/api-key-level";
import type { CommitVO, FieldType, LookupRollup, UserRefVO } from "../../types";
import type { FieldHelp } from "./contract/base-schemas";

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
    help?: FieldHelp;
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
    // Must mirror the contract's fieldOptionsSchema — see base-schemas.ts there.
    date?: {
      includeTime?: boolean;
      timezone?: string;
    };
    embed?: {
      aspectRatio?: "16:9" | "4:3" | "1:1";
      height?: number;
      providers?: string[];
    };
    // Must mirror the contract's fieldOptionsSchema — see base-schemas.ts there.
    formula?: {
      expression: string;
      format?: "auto" | "number" | "currency" | "percent" | "date";
      precision?: number;
      currency?: string;
    };
    inverseFieldId?: string;
    /** Read-only reverse column of this relation field id on the target Base. */
    reverseOfFieldId?: string;
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
   * The viewer's effective node-level permission on this Base (workspace
   * baseline + node grants + credential ceiling). Only set by `bases.get`;
   * absent on list/embedded Bases.
   */
  viewerPermissionLevel?: ApiKeyPermissionLevel;
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

export type ViewFilterConjunction = "and" | "or";

export interface ViewFilterGroupVO {
  conjunction: ViewFilterConjunction;
  conditions: ViewFilterConditionVO[];
}

export type ViewFilterConditionVO = ViewFilterVO | ViewFilterGroupVO;

export const isViewFilterGroup = (
  condition: ViewFilterConditionVO,
): condition is ViewFilterGroupVO => "conditions" in condition;

export const flattenViewFilters = (conditions: readonly ViewFilterConditionVO[]): ViewFilterVO[] =>
  conditions.flatMap((condition) =>
    isViewFilterGroup(condition) ? flattenViewFilters(condition.conditions) : [condition],
  );

/** Map leaves without losing the enclosing boolean expression. */
export const mapViewFilters = (
  conditions: readonly ViewFilterConditionVO[],
  map: (filter: ViewFilterVO) => ViewFilterVO,
): ViewFilterConditionVO[] =>
  conditions.map((condition) =>
    isViewFilterGroup(condition)
      ? { ...condition, conditions: mapViewFilters(condition.conditions, map) }
      : map(condition),
  );

/** Ad-hoc rules always narrow the complete saved expression. */
export const combineViewFilters = (
  config: Pick<ViewConfigVO, "filters" | "filterConjunction"> | undefined,
  adHocFilters: readonly ViewFilterVO[] = [],
): ViewFilterConditionVO[] => [
  ...(config?.filters.length
    ? config.filterConjunction === "or"
      ? [{ conjunction: "or" as const, conditions: config.filters }]
      : config.filters
    : []),
  ...adHocFilters,
];

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
  filters: ViewFilterConditionVO[];
  /** Legacy configs omit this and retain their implicit AND semantics. */
  filterConjunction?: ViewFilterConjunction;
  sorts: ViewSortVO[];
  visibleFieldSlugs?: string[] | null;
  /** Column order is independent of which fields are visible. */
  fieldOrderSlugs?: string[];
  /** Explicitly hidden fields when following future Base schema additions. */
  hiddenFieldSlugs?: string[];
  /** Omitted legacy allowlists remain manual; omitted live lists remain automatic. */
  autoShowNewFields?: boolean;
  /** Table-only column widths in pixels, keyed by field slug. */
  fieldWidths?: Record<string, number>;
  /** Attachment cover: gallery defaults to automatic; Kanban defaults to no cover. */
  coverFieldSlug?: string | null;
  coverFit?: GalleryCoverFit;
  /** Gallery-only card size preset. */
  cardSize?: GalleryCardSize;
  /** Card field labels: Kanban defaults to true, gallery defaults to false. */
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
  /** Shared tab order within the Base; the lowest is the view the Base opens on. */
  position: number;
  createdBy: string;
  createdByUser?: UserRefVO | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const LOOKUP_SOURCE_LIMIT = 25;

export interface LookupComputedVO {
  status: "ready" | "unlinked" | "empty" | "invalid" | "inaccessible";
  /** Safe configuration detail; omitted when the source is unavailable or unauthorized. */
  reason?:
    | "missing_configuration"
    | "missing_relation"
    | "missing_source_configuration"
    | "missing_target_field"
    | "unsupported_source"
    | "unsupported_rollup"
    | "source_base_mismatch"
    | "source_record_archived";
  value: unknown;
  targetField?: BaseFieldVO;
  sourceBaseId?: string;
  sourceBaseSlug?: string;
  sources: Array<{ recordId: string; title: string; value: unknown; headCommitId: string }>;
  sourcesTruncated?: boolean;
  dependencyVersion: string;
  /** Server read-start time, not a causal database revision. */
  dependencyReadAt?: number;
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
  /**
   * Everyone named by this record's PEOPLE-typed CELLS — `member` field values
   * plus the `created_by` / `updated_by` system fields — keyed by user id.
   *
   * Resolved at read time rather than stored on the commit, for the same reason
   * `lookup` is: a display name or avatar can change without this record ever
   * being written, so a name baked into the commit goes stale silently.
   *
   * An id with no entry here is a person this viewer cannot resolve — a former
   * member, an agent actor, or an anonymous visitor on a public surface (the
   * host deliberately withholds identity there). Clients must fall back to the
   * id, never to an empty cell: "who did this work" is a fact worth keeping
   * even when the name is gone.
   */
  fieldUsers?: Record<string, UserRefVO>;
  /** Current read-time derived values, distinct from the stored commit snapshot. */
  computedFields?: Record<string, LookupComputedVO>;
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
