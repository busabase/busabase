import { describe, expect, it, vi } from "vitest";
import { DRAWER_DESTINATIONS, isDrawerAction, isDrawerItemActive } from "./drawer-nav-destinations";

vi.mock("lucide-react-native", () => ({
  Activity: () => null,
  Archive: () => null,
  Bot: () => null,
  FileText: () => null,
  Github: () => null,
  Images: () => null,
  Inbox: () => null,
  LayoutGrid: () => null,
  Network: () => null,
  Shapes: () => null,
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

const appsDestination = DRAWER_DESTINATIONS.find(
  (destination) => !isDrawerAction(destination) && destination.key === "apps",
);
const templatesDestination = DRAWER_DESTINATIONS.find(
  (destination) => !isDrawerAction(destination) && destination.key === "templates",
);

describe("App Launcher / Templates navigation", () => {
  it("lists both, since web reaches them contextually and this drawer has no contextual slot for them", () => {
    expect(appsDestination).toBeDefined();
    expect(templatesDestination).toBeDefined();
  });

  it("keeps App Launcher active on an opened AirApp, not just its own list route", () => {
    if (!appsDestination) return;
    expect(isDrawerItemActive("/drawer/apps", appsDestination)).toBe(true);
    expect(isDrawerItemActive("/airapp/nod_123", appsDestination)).toBe(true);
    expect(isDrawerItemActive("/drawer/templates", appsDestination)).toBe(false);
  });

  it("keeps Templates active on a template's detail route, not just the gallery", () => {
    if (!templatesDestination) return;
    expect(isDrawerItemActive("/drawer/templates", templatesDestination)).toBe(true);
    expect(isDrawerItemActive("/templates/crm-starter", templatesDestination)).toBe(true);
    expect(isDrawerItemActive("/drawer/apps", templatesDestination)).toBe(false);
  });
});

const agentsDestination = DRAWER_DESTINATIONS.find(
  (destination) => !isDrawerAction(destination) && destination.key === "agents",
);

describe("Agents navigation", () => {
  it("keeps Agents active on a connection's session list and chat routes, not just the connections list", () => {
    expect(agentsDestination).toBeDefined();
    if (!agentsDestination) return;
    expect(isDrawerItemActive("/drawer/agents", agentsDestination)).toBe(true);
    expect(isDrawerItemActive("/agents/buda", agentsDestination)).toBe(true);
    expect(isDrawerItemActive("/agents/buda/ses_123", agentsDestination)).toBe(true);
    expect(isDrawerItemActive("/drawer/apps", agentsDestination)).toBe(false);
  });
});
