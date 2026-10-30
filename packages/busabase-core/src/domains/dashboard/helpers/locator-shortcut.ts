/**
 * The keyboard shortcut that copies the current node's (or record's) locator:
 * Cmd+Shift+. on macOS, Ctrl+Shift+. elsewhere.
 *
 * Why this combination:
 * - Ctrl/Cmd+Shift+C is the obvious "copy" mnemonic and is taken — it opens
 *   the element picker in Chrome/Edge/Firefox DevTools.
 * - Cmd/Ctrl+L, +K, +Shift+L/K are browser or app defaults (address bar, the
 *   dashboard's own search on Cmd/Ctrl+K).
 * - Alt/Option combinations type characters on macOS and open menus on
 *   Windows/Linux.
 * - Cmd/Ctrl+Shift+Period has no default in Chrome, Edge, Firefox or Safari and
 *   no other handler in this app; it is the same family Linear uses for its
 *   "copy issue ID" shortcuts.
 *
 * Matched on `event.code` (the physical key), not `event.key`: Shift turns "."
 * into ">" on US layouts and into other characters elsewhere.
 *
 * Pure: takes the event-shaped data it needs, returns booleans and strings.
 */

export type LocatorShortcutEvent = Pick<
  KeyboardEvent,
  "code" | "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "isComposing"
>;

export const isLocatorShortcut = (event: LocatorShortcutEvent): boolean =>
  !event.isComposing &&
  event.shiftKey &&
  !event.altKey &&
  // Exactly one of Cmd/Ctrl — Cmd+Ctrl+Shift+. is not this shortcut.
  event.metaKey !== event.ctrlKey &&
  (event.code === "Period" || event.key === ">" || event.key === ".");

/** Focus in a field the person is typing into — the shortcut must stay out of the way. */
export const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const element = target as HTMLElement;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable ||
    Boolean(element.closest?.('[contenteditable=""], [contenteditable="true"]'))
  );
};

export const isApplePlatform = (platform: string): boolean =>
  /mac|iphone|ipad|ipod/i.test(platform);

/** How the shortcut is written in a tooltip on this platform. */
export const locatorShortcutLabel = (apple: boolean): string => (apple ? "⌘⇧." : "Ctrl+Shift+.");
