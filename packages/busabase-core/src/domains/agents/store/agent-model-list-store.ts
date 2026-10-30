"use client";

import {
  AgentSessionConfigSelectVOSchema,
  type AgentSessionModelOptionVO,
} from "busabase-contract/domains/agents/types";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

const STORAGE_KEY = "busabase-agents-model-list.v1";

/**
 * One remembered model catalog per scoped agent: the config id, its display
 * name, and selectable options with advertised thinking defaults. Never the
 * model's top-level `currentValue` — that is
 * session-owned state (what THIS conversation currently has selected), not a
 * fact about the agent that is safe to reuse for the next brand-new session.
 * Treating a persisted `currentValue` as confirmed would let a stale choice
 * silently become a new session's starting value instead of whatever the
 * agent itself defaults to.
 */
export interface AgentModelCatalogEntry {
  configId: string;
  name: string;
  options: AgentSessionModelOptionVO["options"];
  updatedAt: string;
}

/**
 * A confirmed "this agent has no model selector" — distinguished from a real
 * `AgentModelCatalogEntry` by `configId: null`, and from the key being
 * entirely absent (unknown, never confirmed) by actually occupying the key.
 * Carries its own `updatedAt` so hydration merge can still reconcile
 * tombstone-vs-entry recency per scope, the same as two real entries would.
 */
export interface AgentModelCatalogTombstone {
  configId: null;
  updatedAt: string;
}

export type AgentModelCatalogRecord = AgentModelCatalogEntry | AgentModelCatalogTombstone;

/**
 * Rebuilds each entry field-by-field rather than trusting the parsed object
 * shape — belt-and-suspenders against a legacy or malformed record that
 * happens to also carry a `currentValue` (or any other extra field): only
 * the four fields declared on `AgentModelCatalogEntry` are ever copied out,
 * so there is no field this function could accidentally let through.
 */
const isModelCatalogEntry = (value: unknown): value is AgentModelCatalogEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AgentModelCatalogEntry>;
  return (
    typeof entry.configId === "string" &&
    typeof entry.name === "string" &&
    typeof entry.updatedAt === "string" &&
    Array.isArray(entry.options) &&
    entry.options.every(
      (option) =>
        option &&
        typeof option === "object" &&
        typeof (option as { value?: unknown }).value === "string" &&
        typeof (option as { name?: unknown }).name === "string",
    )
  );
};

const isModelCatalogTombstone = (value: unknown): value is AgentModelCatalogTombstone => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AgentModelCatalogTombstone>;
  return entry.configId === null && typeof entry.updatedAt === "string";
};

const sanitizeModelCatalogEntry = (entry: AgentModelCatalogEntry): AgentModelCatalogEntry => ({
  configId: entry.configId,
  name: entry.name,
  options: entry.options.map((option) => {
    const parsed = AgentSessionConfigSelectVOSchema.safeParse(option.thinking);
    const thinking = parsed.success ? parsed.data : null;
    return {
      value: option.value,
      name: option.name,
      ...(thinking?.id && thinking.options.some((level) => level.value === thinking.currentValue)
        ? { thinking }
        : {}),
    };
  }),
  updatedAt: entry.updatedAt,
});

const sanitizePersistedCatalogs = (value: unknown): Record<string, AgentModelCatalogRecord> => {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap<[string, AgentModelCatalogRecord]>(
      ([key, entry]) => {
        if (key.length === 0) return [];
        if (isModelCatalogTombstone(entry))
          return [[key, { configId: null, updatedAt: entry.updatedAt }]];
        return isModelCatalogEntry(entry) ? [[key, sanitizeModelCatalogEntry(entry)]] : [];
      },
    ),
  ) as Record<string, AgentModelCatalogRecord>;
};

const createAgentModelListStorage = (): StateStorage => ({
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    try {
      const value = window.localStorage.getItem(name);
      // Zustand parses this after `getItem`. Validate here so corrupt JSON is
      // treated like an empty cache rather than aborting hydration.
      if (value !== null) JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage can be disabled or full. The in-memory catalog still works for
      // this tab, so persistence failure must not break the model selector.
    }
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Match get/set's best-effort behavior for restricted browser storage.
    }
  },
});

interface AgentModelListStoreState {
  /**
   * Keyed by `agentModelCatalogScope()`. A key mapped to a tombstone
   * (`configId: null`) is a confirmed "we asked, this agent has no model
   * selector" — kept distinct from the key being entirely absent (unknown,
   * never confirmed). Collapsing those two into "key absent" would make a
   * confirmed-no-selector agent indistinguishable from one never queried,
   * letting a stale truthy fallback (e.g. a stale `active.modelOption`) win
   * again on the next render instead of staying suppressed.
   */
  catalogs: Record<string, AgentModelCatalogRecord>;
  /** False through SSR and the first browser render — see `airapp-runner-store`'s `selectionsHydrated`. */
  catalogsHydrated: boolean;
  /**
   * Record (or confirm-clear) the catalog for `scope`. Pass a tombstone
   * (`{ configId: null, updatedAt }`, see `toAgentModelCatalogTombstone`) for
   * an explicit, confirmed "this agent has no model selector" — distinct
   * from never having called this at all (unknown), which the caller
   * represents by simply not calling this and reading `getCatalog`'s
   * `undefined`.
   */
  setCatalog: (scope: string, entry: AgentModelCatalogRecord) => void;
  getCatalog: (scope: string) => AgentModelCatalogRecord | undefined;
  /** Drops every scope beginning with `scopePrefix` — used on disconnect/logout/account switch. */
  clearScope: (scopePrefix: string) => void;
}

export const useAgentModelListStore = create<AgentModelListStoreState>()(
  persist(
    (set, get) => ({
      catalogs: {},
      catalogsHydrated: false,

      setCatalog: (scope, entry) =>
        set((state) => {
          return { catalogs: { ...state.catalogs, [scope]: entry } };
        }),

      getCatalog: (scope) => get().catalogs[scope],

      clearScope: (scopePrefix) =>
        set((state) => {
          const next = Object.fromEntries(
            Object.entries(state.catalogs).filter(([scope]) => !scope.startsWith(scopePrefix)),
          );
          return Object.keys(next).length === Object.keys(state.catalogs).length
            ? state
            : { catalogs: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(createAgentModelListStorage),
      skipHydration: true,
      onRehydrateStorage: () => () => {
        // Also runs when storage is unavailable or malformed — the empty
        // catalog is safe, and the UI must stay usable rather than wait forever.
        useAgentModelListStore.setState({ catalogsHydrated: true });
      },
      partialize: (state) => ({ catalogs: state.catalogs }),
      // Hydration is async and can resolve after a confirmed write already
      // landed in `currentState` this tab session (e.g. a fast create/config
      // response arriving before localStorage read completes) — merging must
      // not let that stale persisted snapshot clobber a newer in-memory
      // entry. Reconciled per scope by `updatedAt` rather than replacing the
      // whole map, so each scope keeps whichever side is actually newer,
      // tombstone or real entry alike (both carry `updatedAt`).
      merge: (persistedState, currentState) => {
        const persistedCatalogs = sanitizePersistedCatalogs(
          (persistedState as { catalogs?: unknown } | undefined)?.catalogs,
        );
        const catalogs = { ...persistedCatalogs };
        for (const [scope, entry] of Object.entries(currentState.catalogs)) {
          catalogs[scope] = entry;
        }
        return { ...currentState, catalogs };
      },
    },
  ),
);

/**
 * The catalog scope for one host + workspace + actor + agent, JSON-encoded
 * rather than joined with a plain separator — a workspace key, actor id, or
 * agent slug containing `:` would otherwise let two different scopes collapse
 * onto the same cache key (e.g. `host:"a:b":user:slug` colliding with
 * `host:a:"b:user":slug`). JSON array encoding makes each component's
 * boundary unambiguous regardless of its content. Each component is still
 * required (callers pass `"anonymous"`/`"local"` fallbacks explicitly,
 * mirroring `knownNodeCacheScope`) so a local hit can never cross a
 * workspace, account, or agent boundary, and a logged-out visitor can never
 * read a logged-in one's cached catalog.
 */
export const agentModelCatalogScope = (
  host: string,
  workspaceKey: string,
  actorId: string,
  agentSlug: string,
): string => JSON.stringify([host, workspaceKey, actorId, agentSlug]);

/**
 * `agentModelCatalogScope`'s prefix for one actor — pass to `clearScope` on
 * logout/disconnect. Built the same JSON-array way, trimmed before the final
 * `]` so it matches every `agentModelCatalogScope(host, workspaceKey,
 * actorId, <anything>)` as a literal string prefix.
 */
export const agentModelCatalogActorPrefix = (
  host: string,
  workspaceKey: string,
  actorId: string,
): string => JSON.stringify([host, workspaceKey, actorId, ""]).slice(0, -2);

/** Builds a VO-shaped catalog entry from a confirmed `AgentSessionModelOptionVO`. */
export const toAgentModelCatalogEntry = (
  modelOption: AgentSessionModelOptionVO,
  updatedAt: string,
): AgentModelCatalogEntry => ({
  configId: modelOption.id,
  name: modelOption.name,
  options: modelOption.options,
  updatedAt,
});

/** Builds the confirmed "no model selector" tombstone — see `AgentModelCatalogTombstone`. */
export const toAgentModelCatalogTombstone = (updatedAt: string): AgentModelCatalogTombstone => ({
  configId: null,
  updatedAt,
});
