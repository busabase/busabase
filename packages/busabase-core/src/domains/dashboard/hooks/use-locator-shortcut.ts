"use client";

/**
 * Registers "copy this locator" for the keyboard shortcut defined in
 * `helpers/locator-shortcut.ts`.
 *
 * Several surfaces can be mounted at once — a Base page's toolbar under an open
 * record dialog, say — and the shortcut must copy exactly ONE locator, the most
 * specific one in view. So registrations go into one module-level list behind a
 * single window listener: the highest `priority` wins (a record beats its
 * Base), and among equals the most recently mounted one (the dialog on top).
 */

import { useEffect, useRef } from "react";
import { isEditableShortcutTarget, isLocatorShortcut } from "../helpers/locator-shortcut";

/** Whole-node toolbars. */
export const LOCATOR_SHORTCUT_PRIORITY_NODE = 1;
/** A record page or record dialog — more specific than the Base around it. */
export const LOCATOR_SHORTCUT_PRIORITY_RECORD = 2;

interface Registration {
  order: number;
  priority: number;
  run: () => void;
}

const registrations: Registration[] = [];
let nextOrder = 0;

/** Exported for tests: the registration that would handle the shortcut now. */
export const activeLocatorShortcut = (): Registration | undefined =>
  registrations.reduce<Registration | undefined>(
    (best, entry) =>
      !best ||
      entry.priority > best.priority ||
      (entry.priority === best.priority && entry.order > best.order)
        ? entry
        : best,
    undefined,
  );

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.defaultPrevented || !isLocatorShortcut(event)) return;
  if (isEditableShortcutTarget(event.target)) return;
  const active = activeLocatorShortcut();
  if (!active) return;
  event.preventDefault();
  active.run();
};

/**
 * `run` null (an anonymous visitor, a scope with no shortcut) registers
 * nothing. The latest `run` is always used, so callers need not memoize it.
 */
export const useLocatorShortcut = (run: (() => void) | null, priority: number) => {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const enabled = run !== null;

  useEffect(() => {
    if (!enabled) return;
    const registration: Registration = {
      order: nextOrder++,
      priority,
      run: () => runRef.current?.(),
    };
    if (registrations.length === 0) window.addEventListener("keydown", handleKeyDown);
    registrations.push(registration);
    return () => {
      const index = registrations.indexOf(registration);
      if (index >= 0) registrations.splice(index, 1);
      if (registrations.length === 0) window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, priority]);
};
