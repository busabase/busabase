import type { FieldType, ViewConfigVO } from "busabase-contract/types";
import type { iString } from "openlib/i18n/i-string";
import type { ReactNode } from "react";

export interface BusabaseBreadcrumbItem {
  href?: string;
  label: string;
}

export interface BusabaseListGroup {
  count?: number;
  items: ReactNode;
  title?: string;
}

export interface RecordSubmitOptions {
  mergeImmediately?: boolean;
}

// Table pagination controls threaded from the dashboard down to BusaBaseTable.
export interface RecordsPagination {
  /** Whole-base total, or null while the count query is loading. */
  total: number | null;
  /** Records loaded into the client so far (across fetched pages). */
  loaded: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

export interface ViewSubmitOptions {
  mergeImmediately?: boolean;
}

export interface CreateBaseFieldPayload {
  name: iString;
  options?: {
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
}

export interface FieldChip {
  label: string;
  color?: string;
}
