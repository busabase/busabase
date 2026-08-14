import { describe, expect, it } from "vitest";
import {
  CHECK_FOR_UPDATES_ACTION,
  DESKTOP_MENU_EVENT,
  isCheckForUpdatesAction,
} from "./desktop-menu-actions";

describe("desktop menu actions", () => {
  it("uses a Busabase-specific event and recognizes the update action", () => {
    expect(DESKTOP_MENU_EVENT).toBe("busabase://desktop-menu-action");
    expect(isCheckForUpdatesAction(CHECK_FOR_UPDATES_ACTION)).toBe(true);
  });

  it("ignores unknown or malformed actions", () => {
    expect(isCheckForUpdatesAction("reload")).toBe(false);
    expect(isCheckForUpdatesAction(undefined)).toBe(false);
  });
});
