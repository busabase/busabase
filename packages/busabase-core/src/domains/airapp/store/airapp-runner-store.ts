"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { AirAppRunner, AirAppRunnerKind } from "../components/runners/types";

export const DEFAULT_RUNNER_KIND: AirAppRunnerKind = "browser";
const RUNNER_SELECTION_STORAGE_KEY = "busabase-airapp-runner-selections.v1";

const normalizePersistedRunnerKind = (value: unknown): AirAppRunnerKind | null => {
  switch (value) {
    case "browser":
    case "nodepod":
      return "browser";
    case "local":
    case "local-node":
      return "local";
    case "remote":
    case "sandock":
      return "remote";
    default:
      return null;
  }
};

export const createAirAppRunnerSelectionStorage = (): StateStorage => ({
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    try {
      const value = window.localStorage.getItem(name);
      // Zustand parses this after `getItem`. Validate here so corrupt JSON is
      // treated like an empty preference rather than aborting hydration.
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
      // Storage can be disabled or full. The in-memory choice still works for
      // this tab, so persistence failure must not break the runner picker.
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

const persistedRunnerSelections = (
  value: unknown,
  field: "lastEffectiveKinds",
): Record<string, AirAppRunnerKind> => {
  if (!value || typeof value !== "object") return {};
  const persisted = (value as Record<string, unknown>)[field];
  if (!persisted || typeof persisted !== "object") return {};
  return Object.fromEntries(
    Object.entries(persisted).flatMap(([nodeId, value]) => {
      const kind = normalizePersistedRunnerKind(value);
      return nodeId.length > 0 && kind ? [[nodeId, kind]] : [];
    }),
  );
};

/**
 * AirApp runner metadata, keyed globally by node id, so each node retains its
 * own process/log/preview state across navigation. The real detail and iframe
 * DOM trees are independently retained by `AirAppKeepAliveHost`, keyed by
 * workspace scope + route slug. Disposal happens only on an explicit action
 * (`disposeEntry`), such as successful node deletion.
 */

export type AirAppRunStatus =
  | "idle"
  | "loading-files"
  | "installing"
  | "starting"
  | "ready"
  | "error";

export interface AirAppRunEntry {
  status: AirAppRunStatus;
  logLines: string[];
  previewUrl: string | null;
  error: string | null;
  runner: AirAppRunner | null;
  /** Which engine `runner` was built with — kept alongside `runner` so the
   *  engine picker can show the running/last-used engine even though
   *  `AirAppRunner` itself doesn't expose its own kind. */
  runnerKind: AirAppRunnerKind;
}

const MAX_LOG_LINES = 2000;

export const IDLE_ENTRY: AirAppRunEntry = {
  status: "idle",
  logLines: [],
  previewUrl: null,
  error: null,
  runner: null,
  runnerKind: DEFAULT_RUNNER_KIND,
};

interface AirAppRunnerStoreState {
  entries: Record<string, AirAppRunEntry>;
  /** False through SSR and the first browser render. Auto-run waits for this
   *  to become true so it cannot start in-browser before a saved remote choice
   *  has been read. */
  selectionsHydrated: boolean;
  /**
   * The engine a node's last run actually used, per node.
   *
   * This is what HAPPENED, never what was asked for — the request lives on the
   * node itself (`node.settings.airappEngine`), which is why it is reachable
   * from another browser and this is not. Only the auto-run debounce reads it,
   * to know whether opening this node provisions something that costs money.
   *
   * The two were one field once, which is how a fallback came to overwrite a
   * saved preference: the run needed somewhere to record what it did, and the
   * user's setting was the only slot available. Keeping "what ran" here and
   * "what was asked for" on the node keeps a run from ever writing a choice.
   */
  lastEffectiveKinds: Record<string, AirAppRunnerKind>;
  recordEffectiveRunnerKind: (nodeId: string, kind: AirAppRunnerKind) => void;
  /** What auto-run should assume this node costs: what it did last time, else what was asked for. */
  getEffectiveRunnerKind: (nodeId: string) => AirAppRunnerKind;
  /** Starts a fresh run for `nodeId`: disposes any existing runner for that
   *  node first, then resets the entry to a clean "loading-files" state. */
  beginRun: (nodeId: string, runner: AirAppRunner, runnerKind: AirAppRunnerKind) => void;
  setStatus: (nodeId: string, runner: AirAppRunner, status: AirAppRunStatus) => void;
  appendLog: (nodeId: string, runner: AirAppRunner, chunk: string) => void;
  setPreviewUrl: (nodeId: string, runner: AirAppRunner, url: string) => void;
  setError: (nodeId: string, runner: AirAppRunner, message: string) => void;
  /** Records a failure that happened BEFORE a runner could be constructed —
   *  e.g. a malformed `airapp.json`, or no engine on this deployment able to
   *  run the app's runtime. Distinct from `setError` because that one
   *  deliberately ignores writes from a runner that is no longer the current
   *  one, and here there is no runner to identify. Leaves the entry in
   *  `"error"`, which is also what stops auto-run from retrying it on every
   *  render. */
  failBeforeRun: (nodeId: string, runnerKind: AirAppRunnerKind, message: string) => void;
  /** Explicit teardown: disposes the runner (if any) and removes the entry
   *  entirely. Used e.g. when the backing node is deleted. */
  disposeEntry: (nodeId: string) => void;
}

export const useAirAppRunnerStore = create<AirAppRunnerStoreState>()(
  persist(
    (set, get) => ({
      entries: {},
      lastEffectiveKinds: {},
      selectionsHydrated: false,

      recordEffectiveRunnerKind: (nodeId, kind) =>
        set((state) => ({ lastEffectiveKinds: { ...state.lastEffectiveKinds, [nodeId]: kind } })),

      getEffectiveRunnerKind: (nodeId) => get().lastEffectiveKinds[nodeId] ?? DEFAULT_RUNNER_KIND,

      beginRun: (nodeId, runner, runnerKind) => {
        get().entries[nodeId]?.runner?.dispose();
        set((state) => ({
          entries: {
            ...state.entries,
            [nodeId]: {
              status: "loading-files",
              logLines: [],
              previewUrl: null,
              error: null,
              runner,
              runnerKind,
            },
          },
        }));
      },

      setStatus: (nodeId, runner, status) =>
        set((state) => {
          const current = state.entries[nodeId];
          if (current?.runner !== runner) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [nodeId]: { ...current, status },
            },
          };
        }),

      appendLog: (nodeId, runner, chunk) =>
        set((state) => {
          const current = state.entries[nodeId];
          if (current?.runner !== runner) {
            return state;
          }
          const next = [...current.logLines, chunk];
          return {
            entries: {
              ...state.entries,
              [nodeId]: {
                ...current,
                logLines:
                  next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next,
              },
            },
          };
        }),

      setPreviewUrl: (nodeId, runner, url) =>
        set((state) => {
          const current = state.entries[nodeId];
          if (current?.runner !== runner) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [nodeId]: { ...current, previewUrl: url, status: "ready" },
            },
          };
        }),

      setError: (nodeId, runner, message) =>
        set((state) => {
          const current = state.entries[nodeId];
          if (current?.runner !== runner) {
            return state;
          }
          return {
            entries: {
              ...state.entries,
              [nodeId]: { ...current, error: message, status: "error" },
            },
          };
        }),

      failBeforeRun: (nodeId, runnerKind, message) => {
        get().entries[nodeId]?.runner?.dispose();
        set((state) => ({
          entries: {
            ...state.entries,
            [nodeId]: {
              status: "error",
              logLines: [],
              previewUrl: null,
              error: message,
              runner: null,
              runnerKind,
            },
          },
        }));
      },

      disposeEntry: (nodeId) => {
        get().entries[nodeId]?.runner?.dispose();
        set((state) => {
          if (!(nodeId in state.entries)) {
            return state;
          }
          const next = { ...state.entries };
          delete next[nodeId];
          return { entries: next };
        });
      },
    }),
    {
      name: RUNNER_SELECTION_STORAGE_KEY,
      storage: createJSONStorage(createAirAppRunnerSelectionStorage),
      skipHydration: true,
      onRehydrateStorage: () => () => {
        // The callback also runs when storage is unavailable or malformed.
        // In those cases the empty/default preference is safe, and the UI must
        // remain usable instead of waiting forever.
        useAirAppRunnerStore.setState({ selectionsHydrated: true });
      },
      // A live runner contains callbacks and process handles; only
      // `lastEffectiveKinds` is meaningful after a page reload. The debounce it
      // feeds exists to stop a reload from re-provisioning what the previous
      // session already learned is expensive, and a memory-only record forgets
      // that on every page load.
      //
      // A `selectedKinds` map may still sit in this key from before the engine
      // choice moved onto the node. It is deliberately neither read nor
      // migrated: the node's own `settings.airappEngine` is authoritative, and
      // reviving a stale per-browser choice is exactly the behaviour the move
      // was meant to end. zustand drops the unknown key on the next write.
      partialize: (state) => ({
        lastEffectiveKinds: state.lastEffectiveKinds,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        lastEffectiveKinds: persistedRunnerSelections(persistedState, "lastEffectiveKinds"),
      }),
    },
  ),
);
