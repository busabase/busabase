import type { NodeType } from "busabase-contract/domains";

/**
 * What the sidebar's "Workspace" group is currently showing. `workspace` is the
 * canonical node TREE (the resting state); every other key replaces that tree
 * with a FLAT list, which is why the default matters so much here — see
 * `STORAGE_KEY` below.
 *
 * Deliberately NOT a key per node type. Favorites already has its own permanent
 * group directly above this one, and the format-variant types (doc/html/file/
 * form/whiteboard/workflow/base/folder/drive) are what the tree is FOR — a
 * filter per format would just be a worse tree. The two type filters that earn
 * their place are the two node types people reach for as a library rather than
 * as a location: AirApps and Skills.
 *
 * `shared` is a third kind again: not a node type and not a client-side cache,
 * but a server question — "what have I published to the internet?" — answered
 * by `nodes.share.list`. It lists only nodes carrying their OWN live public
 * share row, exactly the set the tree already marks with a globe
 * (`NodeVO.shared`), never the inherited `effectivePublicScope`. A Doc inside
 * a shared folder is reachable, but nobody published the Doc, and there is no
 * grant on it to revoke.
 */
export type WorkspaceFilterKey = "workspace" | "recent" | "shared" | "airapp" | "skill";

/**
 * Menu order. `workspace` leads because it is the default and the way back.
 * `recent` and `shared` sit together above the two object-class options: both
 * answer "which slice of MY stuff", where `airapp`/`skill` answer "which kind
 * of thing".
 */
export const WORKSPACE_FILTERS: readonly WorkspaceFilterKey[] = [
  "workspace",
  "recent",
  "shared",
  "airapp",
  "skill",
];

/**
 * The `nodes.list({ types })` argument for a filter, or `null` when the filter
 * is not a `nodes.list` type query at all (`workspace` reads the already-loaded
 * tree, `recent` reads the client-side known-node cache, and `shared` has its
 * own endpoint, `nodes.share.list`). `null` means "do not fetch THIS way", not
 * "fetch everything" — a caller that treats it as the latter would fire a full
 * untyped `nodes.list` on every tree render, and a caller that treats it as
 * "nothing to fetch at all" would leave `shared` permanently empty.
 */
export const nodeTypesForWorkspaceFilter = (key: WorkspaceFilterKey): NodeType[] | null => {
  switch (key) {
    case "airapp":
      return ["airapp"];
    case "skill":
      return ["skill"];
    default:
      return null;
  }
};

export const isWorkspaceFilterKey = (value: unknown): value is WorkspaceFilterKey =>
  value === "workspace" ||
  value === "recent" ||
  value === "shared" ||
  value === "airapp" ||
  value === "skill";

/**
 * Where the active filter survives a reload. `sessionStorage`, NOT
 * `localStorage`, and the difference is not a style preference:
 *
 * This filter REPLACES the workspace tree rather than sitting beside it. A
 * preference that survived a browser restart would greet someone, days later,
 * with a flat list of Skills and no visible tree anywhere — "where did my
 * workspace go". Session scope keeps the choice sticky while you navigate
 * around within one visit (which is the whole point: pick "Apps", open three of
 * them, the group does not snap back), and quietly resets to the tree on a
 * fresh one.
 *
 * Same reasoning, and the same shape, as `busabase.dashboard.lastContextualNav.v1`
 * in `dashboard-shell.tsx` — "what I'm working through right now", not a durable
 * setting.
 */
const STORAGE_KEY = "busabase.dashboard.sidebarWorkspaceFilter.v1";

/** The resting state, and the fallback for every failure below. */
export const DEFAULT_WORKSPACE_FILTER: WorkspaceFilterKey = "workspace";

/**
 * Read the stored filter, degrading to the tree on anything unexpected: SSR (no
 * `window`), private browsing / disabled storage (throws on access), or a value
 * written by an older or corrupted build. Never throws — the sidebar rendering
 * at all matters more than restoring a filter.
 */
export const readStoredWorkspaceFilter = (): WorkspaceFilterKey => {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isWorkspaceFilterKey(stored) ? stored : DEFAULT_WORKSPACE_FILTER;
  } catch {
    return DEFAULT_WORKSPACE_FILTER;
  }
};

/** Best-effort persist. A failure here costs the stickiness, nothing else. */
export const writeStoredWorkspaceFilter = (key: WorkspaceFilterKey): void => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage unavailable — the component's own state still carries the choice
    // for this render; only surviving a reload is lost.
  }
};
