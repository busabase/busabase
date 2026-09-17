import type { SearchResultKind } from "busabase-contract/types";

export type SearchTab = "recent" | "all" | "records" | "files" | "change_requests";

export interface SearchTabOption {
  value: SearchTab;
  label: string;
  /**
   * A string, not a number: a full page renders as "20+" because the count is a
   * floor. Absent when this tab has not been asked (only the active tab has
   * real numbers) or has nothing.
   */
  meta?: string | number;
}

export interface SearchTabDefinition {
  value: SearchTab;
  label: string;
  kind: SearchResultKind | null;
}
