"use client";

/**
 * Keyboard Shortcuts Hook
 *
 * Ports `apps/buda/src/components/keyboard-shortcuts/use-keyboard-shortcuts.ts`
 * into busabase-core (per the search-quick-jump spec: busabase-core has no
 * dependency relationship with buda-core/apps/buda and shouldn't gain one just
 * for a single small hook — see `apps/busabase/content/spec/search-quick-jump.md`).
 * Deliberately kept byte-for-byte equivalent in behavior: parses a `"cmd+k"`-style
 * modifier string, ignores keydowns while focus is inside an
 * `<input>`/`<textarea>`/`contentEditable` element, and registers a single
 * `window` keydown listener.
 */

import { useCallback, useEffect } from "react";

interface UseKeyboardShortcutOptions {
  keys: string;
  handler: () => void;
  enabled?: boolean;
}

/**
 * Parse key combination string into parts
 * e.g., "cmd+k" -> { meta: true, key: "k" }
 */
function parseKeys(keys: string) {
  const parts = keys.toLowerCase().split("+");
  return {
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
    key: parts.filter((p) => !["cmd", "meta", "ctrl", "shift", "alt", "option"].includes(p))[0],
  };
}

/**
 * Check if keyboard event matches the key combination
 */
function matchesKeys(event: KeyboardEvent, keys: string): boolean {
  const parsed = parseKeys(keys);
  const eventKey = event.key.toLowerCase();

  // Check modifiers
  const metaMatch = parsed.meta ? event.metaKey : !event.metaKey;
  const ctrlMatch = parsed.ctrl ? event.ctrlKey : !event.ctrlKey;
  const shiftMatch = parsed.shift ? event.shiftKey : !event.shiftKey;
  const altMatch = parsed.alt ? event.altKey : !event.altKey;

  // Check key
  const keyMatch = eventKey === parsed.key;

  return metaMatch && ctrlMatch && shiftMatch && altMatch && keyMatch;
}

/**
 * Hook to register a single keyboard shortcut
 */
export function useKeyboardShortcut({ keys, handler, enabled = true }: UseKeyboardShortcutOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (matchesKeys(event, keys)) {
        event.preventDefault();
        handler();
      }
    },
    [keys, handler, enabled],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export { parseKeys, matchesKeys };
