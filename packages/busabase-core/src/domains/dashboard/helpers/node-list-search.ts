import type { NodeVO } from "busabase-contract/types";

/**
 * Client-side ranking for the search dialog's node-type tabs (Skills, Apps).
 *
 * These tabs are backed by `nodes.list({ types: [...] })` — one small, flat,
 * already-ACL-filtered list per type — rather than the heavy full-text `search`
 * procedure. A workspace has tens of Skills/Apps, not thousands, so the whole
 * list is fetched once and filtered here: the result updates on every keystroke
 * with no debounce and no network round-trip, the same "instant" feel the
 * Recent tab gets from its `KnownNode` cache.
 *
 * Deliberately a separate, JSX-free module so the ranking is unit-testable
 * without rendering the dialog.
 */

/** The one shape this module needs — so a test can pass a 3-field literal. */
export type SearchableNodeFields = Pick<NodeVO, "name" | "slug" | "description">;

/**
 * `0` = the user typed part of the node's IDENTITY (name or slug), `1` = it
 * only appears in the description, `null` = no match.
 *
 * Identity beats description on purpose: someone typing "email" who owns a
 * Skill literally called "Email" wants that first, not the six other Skills
 * that merely mention email in their description.
 */
const rankNode = (node: SearchableNodeFields, needle: string): 0 | 1 | null => {
  if (node.name.toLowerCase().includes(needle) || node.slug.toLowerCase().includes(needle)) {
    return 0;
  }
  if (node.description.toLowerCase().includes(needle)) return 1;
  return null;
};

/**
 * Filter `nodes` by `query`, best match first.
 *
 * An empty query returns the list UNCHANGED — that is the tab's "show me
 * everything I have" landing state, and the incoming order is already the
 * server's `position`/`createdAt` ordering (the same order the sidebar and the
 * App Launcher use), so re-sorting it here would make the same nodes appear in
 * two different orders in two places for no reason. Ties within a rank keep
 * that server order too, for the same reason.
 */
export const filterNodeListByQuery = <T extends SearchableNodeFields>(
  nodes: readonly T[],
  query: string,
): T[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];

  const ranked: { node: T; rank: 0 | 1; index: number }[] = [];
  nodes.forEach((node, index) => {
    const rank = rankNode(node, needle);
    if (rank !== null) ranked.push({ node, rank, index });
  });
  ranked.sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index));
  return ranked.map((entry) => entry.node);
};
