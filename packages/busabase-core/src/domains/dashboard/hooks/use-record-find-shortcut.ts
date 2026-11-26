"use client";

import { type RefObject, useEffect, useRef } from "react";
import { isApplePlatform, isEditableShortcutTarget } from "../helpers/locator-shortcut";

/** For `aria-keyshortcuts` on the find input. */
export const RECORD_FIND_KEY_SHORTCUTS = "Control+F Meta+F";

export type RecordFindShortcutEvent = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
>;

/**
 * Plain Cmd+F on Apple platforms, plain Ctrl+F elsewhere — the keys people
 * already press to find on a page. Any other modifier (Cmd+Shift+F, Ctrl+Alt+F)
 * is somebody else's shortcut. Matched on `key` so Dvorak and AZERTY use the
 * key labelled F; a non-Latin layout (whose `key` is not a Latin letter) falls
 * back to the physical F key, as the browser's own find does.
 */
export const isRecordFindShortcut = (event: RecordFindShortcutEvent, apple: boolean): boolean => {
  if (event.isComposing || event.shiftKey || event.altKey) return false;
  if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  return key === "f" || (!/^[a-z]$/.test(key) && event.code === "KeyF");
};

const currentPlatformIsApple = (): boolean =>
  typeof navigator !== "undefined" &&
  isApplePlatform(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent,
  );

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

const isInsideDialog = (node: EventTarget | null): boolean =>
  node instanceof Element && Boolean(node.closest(DIALOG_SELECTOR));

/**
 * Cmd/Ctrl+F moves focus to the record find box while a collection with one is
 * on screen, the way Airtable and Feishu Bitable take over the browser's find
 * (which can only see the rows currently rendered, not the whole view).
 *
 * It stays out of the way when the person is typing somewhere else, when a
 * dialog has focus (or a modal hides the find box), and when the find box
 * already has focus — a second press then reaches the browser's own find.
 */
export const useRecordFindShortcut = (
  inputRef: RefObject<HTMLInputElement | null>,
  onFocusRequest: () => void,
) => {
  const onFocusRequestRef = useRef(onFocusRequest);
  useEffect(() => {
    onFocusRequestRef.current = onFocusRequest;
  });

  useEffect(() => {
    const apple = currentPlatformIsApple();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isRecordFindShortcut(event, apple)) return;
      const input = inputRef.current;
      if (!input || !input.isConnected) return;
      const active = document.activeElement;
      if (active === input || event.target === input) return;
      if (isEditableShortcutTarget(event.target) || isInsideDialog(event.target)) return;
      if (isInsideDialog(active)) return;
      // An open modal (dialog, menu) hides the rest of the page from assistive
      // tech; the find box behind it is not reachable either.
      if (input.closest('[aria-hidden="true"], [inert]')) return;
      event.preventDefault();
      onFocusRequestRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inputRef]);
};
