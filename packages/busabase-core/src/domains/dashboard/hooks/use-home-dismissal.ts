"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-member "I closed this" flags for Home's top cards, persisted in
 * `localStorage` so a closed welcome page or Getting started stays closed on
 * the next visit.
 *
 * Keys carry the known-node cache scope (space + viewer, see
 * `knownNodeCacheScope`), so closing a card in one space — or as one account —
 * never hides it in another. The welcome key also carries the node id: when a
 * manager points the welcome at a different page, every member sees it again.
 *
 * Storage can be unavailable or throw (private browsing, disabled storage), so
 * an in-memory copy keeps the dismissal working for the rest of the session.
 */
const PREFIX = "busabase.dashboard.homeDismissed.v1";

export const homeWelcomeDismissKey = (scope: string, nodeId: string): string =>
  `${PREFIX}:welcome:${encodeURIComponent(scope)}:${encodeURIComponent(nodeId)}`;

export const homeGettingStartedDismissKey = (scope: string): string =>
  `${PREFIX}:gettingStarted:${encodeURIComponent(scope)}`;

const memory = new Map<string, boolean>();
const listeners = new Set<() => void>();

const readStored = (key: string): boolean => {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another tab closed or reopened a card: drop the session copy so the
  // stored value is read again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    if (event.key === null) memory.clear();
    else memory.delete(event.key);
    listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
};

export const setHomeDismissed = (key: string, dismissed: boolean): void => {
  memory.set(key, dismissed);
  try {
    if (dismissed) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // Kept in memory for this session; see the module comment.
  }
  notify();
};

/** `[dismissed, setDismissed]` for one key; a `null` key is never dismissed. */
export const useHomeDismissal = (key: string | null): [boolean, (dismissed: boolean) => void] => {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => (key ? readStored(key) : false),
    // Nothing is dismissed on the server; Home's cards wait for client queries anyway.
    () => false,
  );
  const setDismissed = useCallback(
    (next: boolean) => {
      if (key) setHomeDismissed(key, next);
    },
    [key],
  );
  return [dismissed, setDismissed];
};
