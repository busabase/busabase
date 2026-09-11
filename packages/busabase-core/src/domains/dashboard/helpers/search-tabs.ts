/**
 * The search dialog's tab model — which tabs exist, which backend each one
 * reads, and which of them a given visitor may see.
 *
 * Pure and JSX-free so the rules below are unit-testable without rendering the
 * dialog (which needs an oRPC client, a QueryClient and a router).
 */

export type SearchTab =
  | "recent"
  | "all"
  | "records"
  | "files"
  | "skills"
  | "apps"
  | "change_requests";

/**
 * Every tab, in the order they render and the order `Tab`/`Shift-Tab` cycles.
 *
 * Ordered by what the tab IS, not by when it was added: first the THINGS you
 * open (what you had open lately, your apps, your skills), then the SPECIFIC
 * content kinds (records / files), then the REVIEW queue, with "Content" —
 * the broad merge-of-everything catch-all — trailing at the very end. Most
 * people reaching for Cmd-K want to get back into a specific app or a specific
 * kind of thing, not browse an undifferentiated merge of every content kind,
 * so the narrow, purposeful tabs lead and the broadest one is the fallback you
 * reach for last. Apps sit ahead of Skills because an App is something a
 * person opens and looks at, while a Skill is mostly something an agent picks
 * up.
 */
export const SEARCH_TABS: SearchTab[] = [
  "recent",
  "apps",
  "skills",
  "records",
  "files",
  "change_requests",
  "all",
];

/**
 * The two tabs backed by `nodes.list({ types })` rather than by the full-text
 * `search` procedure — one small, flat, already-ACL-filtered list per node
 * type, fetched once and filtered in the browser.
 *
 * That is a deliberate difference in kind from the content tabs, not an
 * optimization: a Skill or an App is a THING you own, so "show me all of them"
 * has to be the tab's landing state with an empty query — the same way Recent
 * lands on visited nodes — and filtering that list has to feel instant, with no
 * debounce and no request per keystroke. Content tabs cannot work that way
 * (there is no bounded list of "all record text" to hold client-side), which is
 * why these two get their own path instead of another `sources` value.
 */
export type NodeListTab = "skills" | "apps";
export const isNodeListTab = (tab: SearchTab): tab is NodeListTab =>
  tab === "skills" || tab === "apps";

/**
 * Tabs served by the heavier `search` procedure. Everything derived from that
 * one response — the results, `hasMore`, `contentTruncated`, and every content
 * tab's badge count — is only meaningful while one of these is active, because
 * that is the only time the request is allowed to fire.
 */
export const isContentSearchTab = (tab: SearchTab): boolean =>
  tab !== "recent" && !isNodeListTab(tab);

/**
 * The tabs THIS visitor gets. An anonymous (public-link) visitor loses Skills
 * and Apps.
 *
 * Not currently reachable — every anonymous render also passes `chromeless`,
 * which returns before the dialog is mounted at all — but those are two
 * independent props that happen to travel together, and this is the half that
 * would matter if they ever stopped. `nodes.list` IS on busabase-core's
 * anonymous allowlist and is filtered by node VISIBILITY, not by node TYPE, so
 * an anonymous render with chrome would list a publicly-shared Skill's or
 * AirApp's name and description — precisely what `nodes.get` refuses for those
 * types (`publicAccess: "no"`, see `logic/anonymous-allowlist.ts`). Deciding it
 * here makes that boundary structural instead of incidental.
 *
 * Beyond the leak: these two tabs answer "what do I own in this workspace",
 * which is not a question a link visitor has any standing to ask.
 */
export const searchTabsFor = (isAnonymous: boolean): SearchTab[] =>
  isAnonymous ? SEARCH_TABS.filter((tab) => !isNodeListTab(tab)) : SEARCH_TABS;
