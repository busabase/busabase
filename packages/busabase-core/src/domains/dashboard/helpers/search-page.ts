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
  /**
   * Which procedure answers the query.
   *
   * `text` is `search` — ranked, filterable, what people want almost always.
   * `regex` is `grep`, which scans the actual bytes of Drive/Skill files, node
   * bodies and canonical record commits. They are not two renderings of one
   * result set: grep returns line hits with surrounding context and honest
   * coverage, and it accepts none of this page's other filters (see
   * `SUPPORTS_NARROWING`). Keeping the mode in the URL means a pattern search
   * is as pasteable as a text one.
   */
  mode: SearchPageMode;
  /**
   * Regex mode only. Default is INSENSITIVE (`flags: "i"`) — someone reaching
   * for a pattern is usually looking for a string, not asserting its casing,
   * and a silently case-sensitive default produces an empty result that looks
   * like "not here" rather than "not spelled that way".
   */
  caseSensitive: boolean;
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

export const SEARCH_PAGE_MODES = ["text", "regex"] as const;
export type SearchPageMode = (typeof SEARCH_PAGE_MODES)[number];

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

/**
 * The sources `grep` can actually scan.
 *
 * `names` is absent because grep scans CONTENT — a node's name is a column, not
 * a document, and there is nothing to report a line and column within. Offering
 * it in regex mode would be the same mistake the comment above warns about:
 * a control that silently does nothing to one of its own choices.
 */
export const GREP_PAGE_SOURCES = ["records", "files", "nodes"] as const;
export type GrepPageSource = (typeof GREP_PAGE_SOURCES)[number];

export const isGrepSource = (value: SearchPageSource): value is GrepPageSource =>
  (GREP_PAGE_SOURCES as readonly string[]).includes(value);

/** The sources a given mode may offer. */
export const sourcesForMode = (mode: SearchPageMode): readonly SearchPageSource[] =>
  mode === "regex" ? GREP_PAGE_SOURCES : SEARCH_PAGE_SOURCES;

/**
 * Which of this page's narrowing controls the mode's procedure honours.
 *
 * `grep` takes a `scope` of ids and path prefixes, not a sort, a date bound or
 * an author — so in regex mode those three controls would be decoration. This
 * table is what the filter bar reads to decide what to render, rather than each
 * control deciding for itself and drifting.
 */
export const SUPPORTS_NARROWING: Record<
  SearchPageMode,
  {
    sort: boolean;
    datePreset: boolean;
    inNodeId: boolean;
    createdBy: boolean;
    caseSensitive: boolean;
  }
> = {
  text: {
    sort: true,
    datePreset: true,
    inNodeId: true,
    createdBy: true,
    caseSensitive: false,
  },
  regex: {
    sort: false,
    datePreset: false,
    inNodeId: false,
    createdBy: false,
    caseSensitive: true,
  },
};

/**
 * Is this a pattern the browser's own RegExp engine accepts?
 *
 * Checked before the request goes out: an unbalanced bracket is a 400 from the
 * server carrying a raw engine message, and "Invalid regular expression:
 * /foo[/: Unterminated character class" is not something to put in front of
 * someone mid-typing. Node and V8 share the engine the server scans with, so a
 * pattern that compiles here compiles there.
 */
export const isValidPattern = (pattern: string, flags: string): boolean => {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
};

/** The `flags` value a state means, matching the contract's `flags` input. */
export const patternFlags = (state: Pick<SearchPageState, "caseSensitive">): string =>
  state.caseSensitive ? "" : "i";

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
  mode: "text",
  caseSensitive: false,
  sources: [],
  sort: "relevance",
  datePreset: "any",
  inNodeId: "",
  createdBy: "",
};

const isSource = (value: string): value is SearchPageSource =>
  (SEARCH_PAGE_SOURCES as readonly string[]).includes(value);

const isMode = (value: string): value is SearchPageMode =>
  (SEARCH_PAGE_MODES as readonly string[]).includes(value);

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
  const modeRaw = params.get("mode") ?? "";
  const mode = isMode(modeRaw) ? modeRaw : "text";
  return {
    query: params.get("q") ?? "",
    mode,
    caseSensitive: params.get("case") === "1",
    // Repeated `?source=` params, deduped — the same shape the procedure's own
    // `sources` accepts, so the URL reads like the API call it produces.
    // Sources the ACTIVE mode cannot scan are dropped here rather than in the
    // view: a link carrying `?mode=regex&source=names` describes a search grep
    // cannot run, and silently scanning everything is a smaller lie than
    // rendering a chip for a source that is not being searched.
    sources: [...new Set(params.getAll("source").filter(isSource))].filter(
      (source) => mode !== "regex" || isGrepSource(source),
    ),
    sort: isSort(sortRaw) ? sortRaw : "relevance",
    datePreset: isPreset(presetRaw) ? presetRaw : "any",
    // Text search can expand a node to its whole subtree. Unified grep only
    // accepts source-specific ids/path prefixes, so carrying `?in=` in regex
    // mode would advertise a scope the request never applies.
    inNodeId: SUPPORTS_NARROWING[mode].inNodeId ? (params.get("in") ?? "") : "",
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
  if (state.mode !== "text") params.set("mode", state.mode);
  // Only meaningful in regex mode, so it is never written in text mode — two
  // equivalent text searches must serialize identically.
  if (state.mode === "regex" && state.caseSensitive) params.set("case", "1");
  const supportedSources = sourcesForMode(state.mode);
  for (const source of state.sources) {
    if (supportedSources.includes(source)) params.append("source", source);
  }
  // Filters the active mode does not honour are not written: a regex URL
  // carrying `&sort=updated_desc` would promise an ordering grep never applied.
  if (SUPPORTS_NARROWING[state.mode].sort && state.sort !== "relevance") {
    params.set("sort", state.sort);
  }
  if (SUPPORTS_NARROWING[state.mode].datePreset && state.datePreset !== "any") {
    params.set("when", state.datePreset);
  }
  if (SUPPORTS_NARROWING[state.mode].inNodeId && state.inNodeId) {
    params.set("in", state.inNodeId);
  }
  if (SUPPORTS_NARROWING[state.mode].createdBy && state.createdBy) {
    params.set("by", state.createdBy);
  }
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
export const hasActiveNarrowing = (state: SearchPageState): boolean => {
  const supports = SUPPORTS_NARROWING[state.mode];
  return (
    state.sources.length > 0 ||
    (supports.sort && state.sort !== "relevance") ||
    (supports.datePreset && state.datePreset !== "any") ||
    (supports.inNodeId && Boolean(state.inNodeId)) ||
    (supports.createdBy && Boolean(state.createdBy))
  );
};

/**
 * Clear the filters but keep what the person was looking for — AND which mode
 * they are in. Dropping back to text search would silently re-run a pattern as
 * a literal, which is a different question with a plausible-looking answer.
 */
export const clearNarrowing = (state: SearchPageState): SearchPageState => ({
  ...EMPTY_SEARCH_PAGE_STATE,
  query: state.query,
  mode: state.mode,
  caseSensitive: state.caseSensitive,
});

/** The path+query a dialog "see all results" escalation should navigate to. */
export const searchPageHref = (state: SearchPageState): string => {
  const query = serializeSearchPageParams(state);
  return query ? `/search?${query}` : "/search";
};
