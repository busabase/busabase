import { useEffect, useSyncExternalStore } from "react";
import {
  DRAWER_DESTINATIONS,
  type DrawerDestination,
  isDrawerAction,
  isDrawerItemActive,
} from "../components/drawer-nav-destinations";
import {
  type ContextualNavKey,
  getContextualNavKey,
  rememberContextualNavKey,
  subscribeToContextualNav,
} from "../utils/contextual-nav";

const CONTEXTUAL_KEYS: ContextualNavKey[] = ["inbox", "activity", "archived", "assets"];

const isContextualNavKey = (value: string): value is ContextualNavKey =>
  (CONTEXTUAL_KEYS as string[]).includes(value);

const contextualNavKeyForPath = (pathname: string): ContextualNavKey | null => {
  const path = pathname.split("?")[0] ?? pathname;
  for (const destination of DRAWER_DESTINATIONS) {
    if (isContextualNavKey(destination.key) && isDrawerItemActive(path, destination)) {
      return destination.key;
    }
  }
  return null;
};

const contextualNavDestination = (key: ContextualNavKey | null): DrawerDestination | null => {
  if (!key) return null;
  const match = DRAWER_DESTINATIONS.find(
    (destination) => !isDrawerAction(destination) && destination.key === key,
  );
  return match && !isDrawerAction(match) ? match : null;
};

export const useContextualNavDestination = (pathname: string): DrawerDestination | null => {
  const activeKey = contextualNavKeyForPath(pathname);
  const storedKey = useSyncExternalStore(
    subscribeToContextualNav,
    getContextualNavKey,
    getContextualNavKey,
  );

  useEffect(() => {
    if (activeKey) rememberContextualNavKey(activeKey);
  }, [activeKey]);

  return contextualNavDestination(activeKey ?? storedKey);
};
