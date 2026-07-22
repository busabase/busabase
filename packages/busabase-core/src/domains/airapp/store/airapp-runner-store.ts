"use client";

import { create } from "zustand";
import type { AirAppRunner, AirAppRunnerKind } from "../components/runners/types";

const DEFAULT_RUNNER_KIND: AirAppRunnerKind = "nodepod";

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
  /** The user's selected engine per node, independent of whether a run is
   *  currently in flight — read by `RunPanel` before starting a new run, and
   *  set by the engine-picker UI in `AirAppDetailView`. Defaults to
   *  `"nodepod"` (V1's only engine) for any node with no explicit choice. */
  selectedKinds: Record<string, AirAppRunnerKind>;
  selectRunnerKind: (nodeId: string, kind: AirAppRunnerKind) => void;
  getSelectedRunnerKind: (nodeId: string) => AirAppRunnerKind;
  /** Starts a fresh run for `nodeId`: disposes any existing runner for that
   *  node first, then resets the entry to a clean "loading-files" state. */
  beginRun: (nodeId: string, runner: AirAppRunner, runnerKind: AirAppRunnerKind) => void;
  setStatus: (nodeId: string, runner: AirAppRunner, status: AirAppRunStatus) => void;
  appendLog: (nodeId: string, runner: AirAppRunner, chunk: string) => void;
  setPreviewUrl: (nodeId: string, runner: AirAppRunner, url: string) => void;
  setError: (nodeId: string, runner: AirAppRunner, message: string) => void;
  /** Explicit teardown: disposes the runner (if any) and removes the entry
   *  entirely. Used e.g. when the backing node is deleted. */
  disposeEntry: (nodeId: string) => void;
}

export const useAirAppRunnerStore = create<AirAppRunnerStoreState>((set, get) => ({
  entries: {},
  selectedKinds: {},

  selectRunnerKind: (nodeId, kind) =>
    set((state) => ({ selectedKinds: { ...state.selectedKinds, [nodeId]: kind } })),

  getSelectedRunnerKind: (nodeId) => get().selectedKinds[nodeId] ?? DEFAULT_RUNNER_KIND,

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
            logLines: next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next,
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
}));
