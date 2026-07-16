"use client";

import { create } from "zustand";
import type { AirAppRunner, AirAppRunnerKind } from "../components/runners/types";

const DEFAULT_RUNNER_KIND: AirAppRunnerKind = "nodepod";

/**
 * AirApp run state, keyed by node id, so it survives the node-detail registry
 * always returning the same `AirAppDetailView` function reference (see
 * `dashboard/node-detail-registry.tsx`) — React doesn't unmount that component
 * when only the `slug` prop changes, but by lifting the running-Nodepod state
 * into this store instead of component-local `useState`/`useRef`, switching
 * between two different AirApp nodes and back no longer disposes an
 * in-flight or already-running app. Disposal now only happens on an explicit
 * action (`disposeEntry`), e.g. when the node itself is deleted.
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
  setStatus: (nodeId: string, status: AirAppRunStatus) => void;
  appendLog: (nodeId: string, chunk: string) => void;
  setPreviewUrl: (nodeId: string, url: string) => void;
  setError: (nodeId: string, message: string) => void;
  /** Explicit teardown: disposes the runner (if any) and removes the entry
   *  entirely. Used e.g. when the backing node is deleted. */
  disposeEntry: (nodeId: string) => void;
}

const getEntry = (entries: Record<string, AirAppRunEntry>, nodeId: string): AirAppRunEntry =>
  entries[nodeId] ?? IDLE_ENTRY;

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

  setStatus: (nodeId, status) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [nodeId]: { ...getEntry(state.entries, nodeId), status },
      },
    })),

  appendLog: (nodeId, chunk) =>
    set((state) => {
      const current = getEntry(state.entries, nodeId);
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

  setPreviewUrl: (nodeId, url) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [nodeId]: { ...getEntry(state.entries, nodeId), previewUrl: url, status: "ready" },
      },
    })),

  setError: (nodeId, message) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [nodeId]: { ...getEntry(state.entries, nodeId), error: message, status: "error" },
      },
    })),

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
