import { describe, expect, it } from "vitest";
import {
  isApplePlatform,
  isLocatorShortcut,
  type LocatorShortcutEvent,
  locatorShortcutLabel,
} from "./locator-shortcut";

const press = (overrides: Partial<LocatorShortcutEvent>): LocatorShortcutEvent => ({
  code: "Period",
  key: ">",
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  isComposing: false,
  ...overrides,
});

describe("locator shortcut", () => {
  it("matches Cmd+Shift+. and Ctrl+Shift+.", () => {
    expect(isLocatorShortcut(press({ metaKey: true }))).toBe(true);
    expect(isLocatorShortcut(press({ ctrlKey: true }))).toBe(true);
  });

  it("does not collide with DevTools' Ctrl/Cmd+Shift+C or the app's Cmd/Ctrl+K", () => {
    expect(isLocatorShortcut(press({ ctrlKey: true, code: "KeyC", key: "C" }))).toBe(false);
    expect(isLocatorShortcut(press({ metaKey: true, code: "KeyC", key: "C" }))).toBe(false);
    expect(
      isLocatorShortcut(press({ metaKey: true, shiftKey: false, code: "KeyK", key: "k" })),
    ).toBe(false);
  });

  it("requires exactly one of Cmd/Ctrl, Shift, and no Alt or IME composition", () => {
    expect(isLocatorShortcut(press({}))).toBe(false);
    expect(isLocatorShortcut(press({ metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isLocatorShortcut(press({ ctrlKey: true, shiftKey: false, key: "." }))).toBe(false);
    expect(isLocatorShortcut(press({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isLocatorShortcut(press({ ctrlKey: true, isComposing: true }))).toBe(false);
  });

  it("labels the shortcut per platform", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("Win32")).toBe(false);
    expect(locatorShortcutLabel(true)).toBe("⌘⇧.");
    expect(locatorShortcutLabel(false)).toBe("Ctrl+Shift+.");
  });
});
