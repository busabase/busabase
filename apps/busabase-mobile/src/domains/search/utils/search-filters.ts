import type { SearchSort } from "busabase-contract/contract/schemas";

/**
 * The narrowing a phone offers on top of the query.
 *
 * Three of the contract's five filter parameters. `sources` is already spoken
 * for — each tab sends its own (see `search-sources`) — and `inNodeId` is left
 * out deliberately: restricting to a subtree means picking a node, which is a
 * tree browser, not a control that fits beside a search box.
 */
export interface SearchFilters {
  sort: SearchSort;
  /** Preset rather than a free date pair — see `DATE_PRESETS`. */
  datePreset: DatePresetKey;
  /**
   * A creator's actor id, or "" for no author filter.
   *
   * Only ever set by tapping the author shown on a result. There is no
   * "created by me" switch, and that is not an omission: the stored value is a
   * free-form actor id, so `local-producer` and `local-admin` are different
   * identities in one workspace and an agent or an API key can be the creator.
   * A toggle built on the signed-in user's id would silently match nothing —
   * the same trap that left the Inbox's Mine tab permanently empty until the
   * server was asked instead of guessed.
   */
  createdBy: string;
}

export const SEARCH_SORT_OPTIONS = [
  { value: "relevance", label: "Best match" },
  { value: "updated_desc", label: "Recently updated" },
  { value: "updated_asc", label: "Least recently updated" },
  { value: "created_desc", label: "Newest" },
  { value: "created_asc", label: "Oldest" },
] as const satisfies readonly { value: SearchSort; label: string }[];

export const DATE_PRESETS = ["any", "7d", "30d", "365d"] as const;
export type DatePresetKey = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Past week" },
  { value: "30d", label: "Past month" },
  { value: "365d", label: "Past year" },
] as const satisfies readonly { value: DatePresetKey; label: string }[];

/** Days each preset looks back; `any` has no bound at all. */
const PRESET_DAYS: Record<Exclude<DatePresetKey, "any">, number> = {
  "7d": 7,
  "30d": 30,
  "365d": 365,
};

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  sort: "relevance",
  datePreset: "any",
  createdBy: "",
};

/** How many narrowings are active — the number on the Filters button. */
export const activeFilterCount = (filters: SearchFilters): number =>
  (filters.sort === "relevance" ? 0 : 1) +
  (filters.datePreset === "any" ? 0 : 1) +
  (filters.createdBy ? 1 : 0);

export const hasActiveFilters = (filters: SearchFilters): boolean => activeFilterCount(filters) > 0;

/**
 * The filters as `search()` input.
 *
 * Defaults are OMITTED rather than sent explicitly: an older server that does
 * not know a parameter ignores it either way, but omitting keeps the request —
 * and the react-query key built from it — identical to what an unfiltered
 * search sent before this feature existed.
 *
 * `updatedAfter` is an inclusive ISO 8601 instant with an offset. The contract
 * rejects a bare local time, and `toISOString()` always produces `Z`.
 */
export const searchFilterInput = (
  filters: SearchFilters,
  now: Date,
): { sort?: SearchSort; updatedAfter?: string; createdBy?: string } => {
  const input: { sort?: SearchSort; updatedAfter?: string; createdBy?: string } = {};
  if (filters.sort !== "relevance") input.sort = filters.sort;
  if (filters.datePreset !== "any") {
    const days = PRESET_DAYS[filters.datePreset];
    input.updatedAfter = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  if (filters.createdBy) input.createdBy = filters.createdBy;
  return input;
};
