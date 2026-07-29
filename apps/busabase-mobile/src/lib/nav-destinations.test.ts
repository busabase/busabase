import { describe, expect, it, vi } from "vitest";
import { DRAWER_DESTINATIONS, isDrawerAction, isDrawerItemActive } from "./nav-destinations";

vi.mock("lucide-react-native", () => ({
  Activity: () => null,
  Archive: () => null,
  FileText: () => null,
  Github: () => null,
  Images: () => null,
  Inbox: () => null,
  Network: () => null,
  Table2: () => null,
}));

const assetsDestination = DRAWER_DESTINATIONS.find(
  (destination) => !isDrawerAction(destination) && destination.key === "assets",
);

describe("asset navigation", () => {
  it("keeps the Assets destination active on the singular detail route", () => {
    expect(assetsDestination).toBeDefined();
    if (!assetsDestination) return;

    expect(isDrawerItemActive("/asset/ast_123", assetsDestination)).toBe(true);
    expect(isDrawerItemActive("/drawer/assets", assetsDestination)).toBe(true);
    expect(isDrawerItemActive("/assets/ast_123", assetsDestination)).toBe(false);
  });
});
