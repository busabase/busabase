import type { SearchSpace } from "../components/search-spaces-slot";
import { normalizeSearchText } from "./search";

/** Enough to find the one you mean; the full list is a page of its own. */
export const SEARCH_SPACES_LIMIT = 5;

/**
 * The spaces a typed query can switch to: name matches, the active space left
 * out, names that START with the query ahead of names that merely contain it,
 * otherwise in the host's order.
 *
 * Only a query finds spaces. With an empty query the dialog is for browsing this
 * space, and people with one or two spaces — most of them — should never see a
 * section that is not about the work in front of them.
 */
export const matchSearchSpaces = (
  spaces: readonly SearchSpace[],
  activeSpaceId: string | undefined,
  query: string,
  limit = SEARCH_SPACES_LIMIT,
): SearchSpace[] => {
  const needle = normalizeSearchText(query);
  if (!needle) return [];
  const matches = spaces
    .filter((space) => space.id !== activeSpaceId)
    .map((space, index) => ({ space, index, name: normalizeSearchText(space.name) }))
    .filter((entry) => entry.name.includes(needle));
  matches.sort(
    (a, b) =>
      Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)) || a.index - b.index,
  );
  return matches.slice(0, limit).map((entry) => entry.space);
};
