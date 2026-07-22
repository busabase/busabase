"use client";

import { create } from "zustand";

interface AirAppKeepAliveStoreState {
  scopes: Record<string, string[]>;
  register: (scopeKey: string, slug: string) => void;
  release: (scopeKey: string, slug: string) => void;
  releaseSlug: (slug: string) => void;
  reset: () => void;
}

const withoutEmptyScopes = (scopes: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(scopes).filter(([, slugs]) => slugs.length > 0));

/**
 * Page-lifetime registry of AirApp detail trees that must stay mounted.
 * Entries are isolated by workspace scope and intentionally are not persisted:
 * a full page refresh clears both this registry and the iframe memory it owns.
 */
export const useAirAppKeepAliveStore = create<AirAppKeepAliveStoreState>((set) => ({
  scopes: {},

  register: (scopeKey, slug) =>
    set((state) => {
      const current = state.scopes[scopeKey] ?? [];
      if (current.includes(slug)) {
        return state;
      }
      return {
        scopes: {
          ...state.scopes,
          [scopeKey]: [...current, slug],
        },
      };
    }),

  release: (scopeKey, slug) =>
    set((state) => {
      const current = state.scopes[scopeKey];
      if (!current?.includes(slug)) {
        return state;
      }
      return {
        scopes: withoutEmptyScopes({
          ...state.scopes,
          [scopeKey]: current.filter((value) => value !== slug),
        }),
      };
    }),

  releaseSlug: (slug) =>
    set((state) => {
      if (!Object.values(state.scopes).some((slugs) => slugs.includes(slug))) {
        return state;
      }
      return {
        scopes: withoutEmptyScopes(
          Object.fromEntries(
            Object.entries(state.scopes).map(([scopeKey, slugs]) => [
              scopeKey,
              slugs.filter((value) => value !== slug),
            ]),
          ),
        ),
      };
    }),

  reset: () => set({ scopes: {} }),
}));

export const airAppSidePanelTabId = (nodeId: string) => `airapp-${nodeId}`;
