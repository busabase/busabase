import type { FieldType, LookupRollup, ViewConfigVO, ViewType } from "busabase-contract/types";
import type { iString } from "openlib/i18n/i-string";
import type { ReactNode } from "react";
import type { FormulaFieldOptions } from "./formula-field";

export interface BusabaseBreadcrumbItem {
  href?: string;
  label: string;
  /**
   * Marks the crumb that names the NODE this route belongs to, which is not
   * always the last one: a Base's view/record/design routes append the view
   * name, the record title or "Design" after it. The topbar hangs the node's
   * emphasis and its Info button on this crumb, so the Info tooltip/dialog
   * always sits against the node it actually describes. Unset on routes that
   * have no node (Inbox, Agents, …), where the topbar falls back to the last
   * crumb.
   */
  isNode?: boolean;
}

export interface BusabaseListGroup {
  count?: number;
  items: ReactNode;
  title?: string;
}

export interface RecordSubmitOptions {
  mergeImmediately?: boolean;
}

/** Transient state owned by one workspace/user collection and exact query. */
export interface BaseTableViewState {
  scope: string;
  selectedRecordIds: string[];
  scrollTop: number;
  scrollLeft: number;
}

// Table pagination controls threaded from the dashboard down to BusaBaseTable.
export interface RecordsPagination {
  page: number;
  pageSize: 25 | 50 | 100;
  total: number;
  totalPages: number;
  isLoading: boolean;
  isFetching?: boolean;
  error?: string | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: 25 | 50 | 100) => void;
  onRetry?: () => void;
  getPageHref?: (page: number) => string;
}

export interface ViewSubmitOptions {
  mergeImmediately?: boolean;
}

/**
 * What the field edit dialog can change in one update change request. `choices`
 * is only sent for select / multiselect fields, and replaces the whole list —
 * choice ids are the stored cell values, so a renamed choice keeps its id.
 */
export interface UpdateBaseFieldPatch {
  lookup?: {
    relationFieldSlug: string;
    targetFieldSlug: string;
    rollup?: LookupRollup;
    limit?: "all" | "first";
  };
  help?: { description?: string; example?: string } | null;
  name?: iString;
  choices?: Array<{ color?: string; id: string; name: string }>;
  /** A date field's time settings; merged into the field's existing options. */
  date?: { includeTime?: boolean; timezone?: string };
  formula?: FormulaFieldOptions;
}

export interface CreateBaseFieldPayload {
  originViewId?: string;
  name: iString;
  options?: {
    help?: { description?: string; example?: string };
    ai?: {
      model?: string;
      prompt?: string;
      reviewRequired?: boolean;
      sourceFieldIds?: string[];
    };
    choices?: Array<{
      color?: string;
      id: string;
      name: string;
    }>;
    code?: {
      language?: string;
    };
    date?: {
      includeTime?: boolean;
      timezone?: string;
    };
    formula?: FormulaFieldOptions;
    lookup?: {
      relationFieldSlug: string;
      targetFieldSlug: string;
      rollup?: LookupRollup;
      limit?: "all" | "first";
    };
    multiple?: boolean;
    number?: {
      format?: "plain" | "currency";
      currency?: string;
      locale?: string;
    };
    targetBaseId?: string;
  };
  required?: boolean;
  slug: string;
  type?: FieldType;
}

export interface ViewFormPayload {
  config?: ViewConfigVO;
  description?: string;
  message?: string;
  name: string;
  slug?: string;
  submittedBy?: string;
  type?: ViewType;
}

export type ViewUpdatePayload = Omit<ViewFormPayload, "config" | "name"> & {
  config?: Partial<ViewConfigVO>;
  name?: string;
};

export interface FieldChip {
  label: string;
  color?: string;
}
