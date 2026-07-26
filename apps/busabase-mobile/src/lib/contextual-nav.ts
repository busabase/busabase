import { useEffect, useSyncExternalStore } from "react";
import {
  DRAWER_DESTINATIONS,
  type DrawerDestination,
  isDrawerAction,
  isDrawerItemActive,
} from "./nav-destinations";

/**
 * The functional areas that get a lingering drawer row. Deliberately the same
 * four the web dashboard uses (`ContextualNavKey` in dashboard-shell.tsx) —
 * Records / Bases / Graph View live only in the Space Selector sheet, so the
 * drawer can never regrow into the shortcut list this design replaced.
 */
export type ContextualNavKey = "inbox" | "activity" | "archived" | "assets";

const CONTEXTUAL_KEYS: ContextualNavKey[] = ["inbox", "activity", "archived", "assets"];

const isContextualNavKey = (value: string): value is ContextualNavKey =>
  (CONTEXTUAL_KEYS as string[]).includes(value);

/** Maps an expo-router pathname onto its contextual destination, or null. */
export const contextualNavKeyForPath = (pathname: string): ContextualNavKey | null => {
  const path = pathname.split("?")[0] ?? pathname;
  for (const destination of DRAWER_DESTINATIONS) {
    if (isContextualNavKey(destination.key) && isDrawerItemActive(path, destination)) {
      return destination.key;
    }
  }
  return null;
};

export const contextualNavDestination = (
  key: ContextualNavKey | null,
): DrawerDestination | null => {
  if (!key) {
    return null;
  }
  // The list also holds non-navigating action entries (Install from GitHub…);
  // only a real route can become the drawer's contextual row.
  const match = DRAWER_DESTINATIONS.find(
    (destination) => !isDrawerAction(destination) && destination.key === key,
  );
  return match && !isDrawerAction(match) ? match : null;
};

/**
 * Module-level store — NOT component state.
 *
 * `DrawerScaffold` is re-mounted by every screen (each screen wraps its own
 * content; there is no shared `app/drawer/_layout.tsx`), so React state would
 * be thrown away on every single navigation, which is exactly when this row
 * has to survive. Living outside React means a freshly mounted scaffold reads
 * the value that the previous screen wrote.
 *
 * Scoped to the running app process on purpose, mirroring web's use of
 * `sessionStorage`: the row means "what I'm working through right now", not a
 * durable preference, so a cold start correctly opens on the resting
 * Home + Search drawer. (Hence no AsyncStorage — persisting it across launches
 * would diverge from web.)
 */
let lastContextualKey: ContextualNavKey | null = null;
const listeners = new Set<() => void>();

const getSnapshot = () => lastContextualKey;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const rememberContextualNavKey = (key: ContextualNavKey) => {
  if (lastContextualKey === key) return;
  lastContextualKey = key;
  for (const listener of listeners) listener();
};

/** Test-only reset so specs don't leak the module-level value into each other. */
export const resetContextualNavKey = () => {
  lastContextualKey = null;
  for (const listener of listeners) listener();
};

/**
 * The one destination the drawer should surface right now: the current route
 * when it is one of the four, otherwise the last one visited. Never more than
 * one, and always replaced (never stacked).
 */
export const useContextualNavDestination = (pathname: string): DrawerDestination | null => {
  const activeKey = contextualNavKeyForPath(pathname);
  const storedKey = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (activeKey) rememberContextualNavKey(activeKey);
  }, [activeKey]);

  return contextualNavDestination(activeKey ?? storedKey);
};
