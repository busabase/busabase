"use client";

// The seam that lets Cmd-K switch spaces without busabase-core knowing what a
// list of spaces is. Only a multi-space host (Cloud) has one; the open-source,
// single-user `apps/busabase` provides nothing, so `useContext` resolves to the
// default `null` and the search dialog never shows a Spaces section there.
//
// Same "host injects, core consumes" pattern as
// `NodeSettingsPermissionsSlotProvider`.
import { createContext, useContext } from "react";

export interface SearchSpace {
  id: string;
  name: string;
  /**
   * Logo image URL. Anything that is not an image address (Cloud stores icon
   * NAMES such as "Box" for spaces without an upload) falls back to the name's
   * first letter.
   */
  logo?: string;
  /** One short line next to the name, already localized by the host (e.g. role · plan). */
  subtitle?: string;
}

export interface SearchSpacesSlot {
  /**
   * Spaces matched instantly as the user types. With `search`, these are the
   * few the host already holds (recent ones); without it, every space.
   */
  spaces: readonly SearchSpace[];
  /**
   * Find spaces by name on the host's server, for people in more spaces than
   * the host loads up front. Merged after the instant matches.
   */
  search?: (query: string) => Promise<readonly SearchSpace[]>;
  /** The space being searched; never offered as a switch target. */
  activeSpaceId?: string;
  onSwitch: (spaceId: string) => void;
}

const SearchSpacesSlotContext = createContext<SearchSpacesSlot | null>(null);

export const SearchSpacesSlotProvider = SearchSpacesSlotContext.Provider;
export const useSearchSpacesSlot = () => useContext(SearchSpacesSlotContext);
