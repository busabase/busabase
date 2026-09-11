import type { SearchResultKind } from "busabase-contract/types";

/**
 * The search dialog's SECTION model — what replaced its tab strip.
 *
 * Why sections instead of tabs. Of the products whose search has tabs (Slack,
 * Teams, GitHub, Confluence) every tab is a filter over one homogeneous result
 * set; ours had grown to seven, five of which were "show only this kind". Notion
 * — the closest analogue, being a workspace of mixed content types — has no tabs
 * at all: one overlay, results grouped under labelled sections, and a filter
 * control for narrowing. That is what this models.
 *
 * Two properties this file exists to keep true:
 *
 * 1. **Every section is fed by its own scoped request.** `search()` applies its
 *    `limit` per source and only slices the concatenation at the end, with
 *    records concatenated FIRST — so one combined call in a record-heavy
 *    workspace returns 20 records and zero files even when files match. Asking
 *    per source gives each section its own budget. The `sources` parameter was
 *    added for exactly this ("`search()` has no way to skip the expensive
 *    records-ranking query otherwise"), so this is its intended use, not a
 *    workaround.
 * 2. **The filter never invents capability.** Its options are precisely the tabs
 *    it replaced, so nothing a user could reach before became unreachable.
 *    Filtering by an arbitrary node type would be new capability and is
 *    deliberately out of scope here.
 */

export type SearchSectionKey =
  /** Nodes this person has actually opened. Local cache only, instant. */
  | "recent"
  /** Every other node whose NAME matches — `nodes.searchByName`, all types. */
  | "workspace"
  /** Every app in the space. Empty-query only; a typed query finds apps under `workspace`. */
  | "apps"
  /** Every skill in the space. Same empty-query-only rule as `apps`. */
  | "skills"
  /** Record rows whose field values match — `search({ sources: ["records"] })`. */
  | "records"
  /** Assets by name/path/content — `search({ sources: ["files"] })`. */
  | "files"
  /** Doc/HTML/whiteboard/workflow BODIES — `search({ sources: ["nodes"] })`. */
  | "docContent"
  /** Bases matched by their own name or a field's name — `search({ sources: ["names"] })`. */
  | "bases"
  /** Change requests — the one kind `search` returns that the others exclude. */
  | "changeRequests";

/**
 * Filter options, in menu order.
 *
 * Deliberately the exact set of tabs this replaced (plus "all"): every option
 * maps onto something a user could already do, so the redesign cannot silently
 * drop a capability. New axes — filter by any node type, by author, by date —
 * belong to the later phases that need backend support for them.
 */
export type SearchFilterKey = "all" | "apps" | "skills" | "records" | "files" | "changeRequests";
export const SEARCH_FILTERS: SearchFilterKey[] = [
  "all",
  "apps",
  "skills",
  "records",
  "files",
  "changeRequests",
];

/** Sections shown with an EMPTY query: things to browse, not things matched. */
const EMPTY_QUERY_SECTIONS: Record<SearchFilterKey, SearchSectionKey[]> = {
  all: ["recent", "apps", "skills"],
  apps: ["apps"],
  skills: ["skills"],
  // Content sections have nothing to show without a query — there is no
  // "browse every record" that belongs in a quick-search overlay.
  records: [],
  files: [],
  changeRequests: [],
};

/**
 * Sections shown WITH a query.
 *
 * `apps`/`skills` are absent from the "all" list on purpose: with a query, an
 * app matches by name and so already appears under `recent` or `workspace`.
 * Listing it a second time under its own heading would be the same node twice.
 */
const QUERY_SECTIONS: Record<SearchFilterKey, SearchSectionKey[]> = {
  all: ["recent", "workspace", "records", "files", "docContent", "bases", "changeRequests"],
  apps: ["apps"],
  skills: ["skills"],
  records: ["records"],
  files: ["files"],
  changeRequests: ["changeRequests"],
};

/**
 * `?? []` is not dead code: the caller `.map()`s this straight into JSX, and the
 * active filter is persisted UI state. A value that predates a rename — or any
 * future key this table forgets — would otherwise blank the whole dialog rather
 * than merely show nothing under that filter.
 */
export const sectionsFor = (filter: SearchFilterKey, hasQuery: boolean): SearchSectionKey[] =>
  (hasQuery ? QUERY_SECTIONS : EMPTY_QUERY_SECTIONS)[filter] ?? [];

/** Sections backed by the node-name path rather than by `search()`. */
export const isNodeSection = (section: SearchSectionKey): boolean =>
  section === "recent" || section === "workspace" || section === "apps" || section === "skills";

/**
 * The `search()` result kind each content section keeps.
 *
 * One scoped request per section already narrows the SOURCE; this narrows the
 * KIND, because `sources: ["records"]` returns both `record` and the
 * `change_request` rows those records came from.
 */
export const KIND_FOR_SECTION: Partial<Record<SearchSectionKey, SearchResultKind>> = {
  records: "record",
  files: "file",
  docContent: "node",
  bases: "base",
  changeRequests: "change_request",
};

/**
 * An anonymous (public-link) visitor never sees the sections that answer "what
 * do I own in this workspace" — same boundary the tab version enforced, kept
 * because `nodes.list` is on busabase-core's anonymous allowlist and filters by
 * node VISIBILITY, not node TYPE, while Skills and AirApps both declare
 * `publicAccess: "no"`.
 */
export const searchFiltersFor = (isAnonymous: boolean): SearchFilterKey[] =>
  isAnonymous ? SEARCH_FILTERS.filter((f) => f !== "apps" && f !== "skills") : SEARCH_FILTERS;

export const visibleSectionsFor = (
  filter: SearchFilterKey,
  hasQuery: boolean,
  isAnonymous: boolean,
): SearchSectionKey[] => {
  const sections = sectionsFor(filter, hasQuery);
  if (!isAnonymous) return sections;
  return sections.filter((section) => section !== "apps" && section !== "skills");
};
