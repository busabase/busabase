import type { SearchResultKind } from "busabase-contract/types";

export type SearchTab = "recent" | "all" | "records" | "files" | "change_requests";

export interface SearchTabOption {
  value: SearchTab;
  label: string;
  meta?: number;
}

export interface SearchTabDefinition {
  value: SearchTab;
  label: string;
  kind: SearchResultKind | null;
}
