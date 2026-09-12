// TYPE-only, and from `contract/schemas` rather than `types`: `SearchSort` is
// declared next to the zod enum it is inferred from and is not re-exported by
// the `types` entry. `import type` is erased at build time, so this costs the
// browser bundle nothing — importing the VALUE `SEARCH_SORTS` from here would
// not be free, which is why the list below is declared locally instead.
import type { SearchSort } from "busabase-contract/contract/schemas";

/**
 * The full-page search's state, and the URL it round-trips through.
 *
 * The URL is the single source of truth on purpose: a search someone spent time
 * narrowing — this folder, that author, edited since March, oldest first — is
 * exactly the kind of thing people paste to a colleague or keep in a tab. State
 * held only in React would make the address bar lie about what is on screen.
 */
export interface SearchPageState {
  query: string;
  /** Empty = every source, matching the procedure's own "omitted means all". */
  sources: SearchPageSource[];
  sort: SearchSort;
  /** Preset rather than a free date pair: see `DATE_PRESETS`. */
  datePreset: DatePresetKey;
  /** Subtree restriction, by node id. */
  inNodeId: string;
  /** Creator, as a free-form actor id. */
  createdBy: string;
}

/**
 * Deliberately NOT the dialog's filter list.
 *
 * The dialog offers Apps and Skills, which come from `nodes.list` — a different
 * procedure that none of this page's filters (sort, date range, subtree, author)
 * can be applied to. Offering them here would put six controls on screen that
 * silently do nothing to two of the choices, which is worse than not offering
 * them: the page would look more capable than it is.
 */
export const SEARCH_PAGE_SOURCES = ["records", "files", "nodes", "names"] as const;
export type SearchPageSource = (typeof SEARCH_PAGE_SOURCES)[number];

export const DATE_PRESETS = ["any", "7d", "30d", "365d"] as const;
export type DatePresetKey = (typeof DATE_PRESETS)[number];

/** Days each preset looks back; `any` has no bound at all. */
const PRESET_DAYS: Record<Exclude<DatePresetKey, "any">, number> = {
  "7d": 7,
  "30d": 30,
  "365d": 365,
};

export const EMPTY_SEARCH_PAGE_STATE: SearchPageState = {
  query: "",
  sources: [],
  sort: "relevance",
  datePreset: "any",
  inNodeId: "",
  createdBy: "",
};

const isSource = (value: string): value is SearchPageSource =>
  (SEARCH_PAGE_SOURCES as readonly string[]).includes(value);

/**
 * The sort options this page offers, in the order it offers them.
 *
 * Declared here rather than imported: the contract's `SEARCH_SORTS` is a VALUE
 * living in `contract/schemas.ts`, and `busabase-contract/types` re-exports only
 * types — importing it from there typechecks and is `undefined` at runtime.
 * `satisfies` still pins every entry to a real `SearchSort`, so a rename in the
 * contract breaks this build instead of silently producing a dead option.
 */
export const SEARCH_PAGE_SORTS = [
  "relevance",
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
] as const satisfies readonly SearchSort[];

const isSort = (value: string): value is SearchSort =>
  (SEARCH_PAGE_SORTS as readonly string[]).includes(value);

const isPreset = (value: string): value is DatePresetKey =>
  (DATE_PRESETS as readonly string[]).includes(value);

/**
 * Read state out of a query string.
 *
 * Every field degrades to its default rather than throwing: this parses whatever
 * is in someone's address bar, including a hand-edited or truncated link, and a
 * page that renders a default search beats one that renders an error nobody can
 * act on.
 */
export const parseSearchPageParams = (search: string): SearchPageState => {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sortRaw = params.get("sort") ?? "";
  const presetRaw = params.get("when") ?? "";
  return {
    query: params.get("q") ?? "",
    // Repeated `?source=` params, deduped — the same shape the procedure's own
    // `sources` accepts, so the URL reads like the API call it produces.
    sources: [...new Set(params.getAll("source").filter(isSource))],
    sort: isSort(sortRaw) ? sortRaw : "relevance",
    datePreset: isPreset(presetRaw) ? presetRaw : "any",
    inNodeId: params.get("in") ?? "",
    createdBy: params.get("by") ?? "",
  };
};

/**
 * Write state back to a query string.
 *
 * Defaults are OMITTED, never written as empty params. A freshly opened page
 * produces `?q=invoice`, not `?q=invoice&sort=relevance&when=any&in=&by=` — the
 * short URL is the one people are willing to paste, and it also means two
 * equivalent searches serialize identically.
 */
export const serializeSearchPageParams = (state: SearchPageState): string => {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  for (const source of state.sources) params.append("source", source);
  if (state.sort !== "relevance") params.set("sort", state.sort);
  if (state.datePreset !== "any") params.set("when", state.datePreset);
  if (state.inNodeId) params.set("in", state.inNodeId);
  if (state.createdBy) params.set("by", state.createdBy);
  return params.toString();
};

/**
 * The `updatedAfter` bound a preset means, as an ISO instant, or undefined for
 * "any time".
 *
 * `now` is a parameter rather than a `Date.now()` call so this stays a pure
 * function — the alternative is a test that either freezes global time or
 * asserts on a moving target.
 */
export const presetToUpdatedAfter = (preset: DatePresetKey, now: Date): string | undefined => {
  if (preset === "any") return undefined;
  const bound = new Date(now.getTime() - PRESET_DAYS[preset] * 24 * 60 * 60 * 1000);
  return bound.toISOString();
};

/** True when anything beyond the query itself is narrowing the results. */
export const hasActiveNarrowing = (state: SearchPageState): boolean =>
  state.sources.length > 0 ||
  state.sort !== "relevance" ||
  state.datePreset !== "any" ||
  Boolean(state.inNodeId) ||
  Boolean(state.createdBy);

/** Clear the filters but keep what the person was looking for. */
export const clearNarrowing = (state: SearchPageState): SearchPageState => ({
  ...EMPTY_SEARCH_PAGE_STATE,
  query: state.query,
});

/** The path+query a dialog "see all results" escalation should navigate to. */
export const searchPageHref = (state: SearchPageState): string => {
  const query = serializeSearchPageParams(state);
  return query ? `/search?${query}` : "/search";
};
