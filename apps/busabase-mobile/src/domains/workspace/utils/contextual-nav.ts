export type ContextualNavKey = "inbox" | "activity" | "archived" | "assets";

let lastContextualKey: ContextualNavKey | null = null;
const listeners = new Set<() => void>();

export const getContextualNavKey = () => lastContextualKey;

export const subscribeToContextualNav = (listener: () => void) => {
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

/** Test-only reset so specs do not leak the module-level value. */
export const resetContextualNavKey = () => {
  lastContextualKey = null;
  for (const listener of listeners) listener();
};
