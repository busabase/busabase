import type { NodeRouteStateVO } from "busabase-contract/contract/node-route-state-schemas";
import { describe, expect, it } from "vitest";
import { shouldMountResidentAirApp, shouldShowRouteGuardSkeleton } from "./node-route-guard";

const active: NodeRouteStateVO = { status: "active", nodeId: "nod_1" };
const unavailable: NodeRouteStateVO = { status: "unavailable" };
const archived: NodeRouteStateVO = {
  status: "archived",
  nodeId: "nod_1",
  type: "doc",
  name: "Archived Doc",
  slug: "archived-doc",
  archivedAt: "2026-09-03T00:00:00.000Z",
  canRestore: true,
};

describe("route guard skeleton", () => {
  it("covers the page until the guard has answered", () => {
    expect(shouldShowRouteGuardSkeleton(undefined)).toBe(true);
  });

  it("keeps a resolved page rendered while the guard revalidates", () => {
    // The regression this pins: any node merge invalidates the route-state
    // query, so gating on `isFetching` replaced an open Doc with a skeleton on
    // every save — unmounting the editor and discarding its unsaved draft.
    for (const state of [active, archived, unavailable]) {
      expect(shouldShowRouteGuardSkeleton(state)).toBe(false);
    }
  });
});

describe("resident AirApp mounting", () => {
  it("mounts only a resolved active AirApp route", () => {
    expect(shouldMountResidentAirApp(true, active)).toBe(true);
  });

  it("refuses to mount before the guard resolves, so an archived URL cannot run", () => {
    expect(shouldMountResidentAirApp(true, undefined)).toBe(false);
  });

  it("unmounts a resolved archived or unavailable AirApp route", () => {
    expect(shouldMountResidentAirApp(true, archived)).toBe(false);
    expect(shouldMountResidentAirApp(true, unavailable)).toBe(false);
  });

  it("never mounts off an AirApp route", () => {
    expect(shouldMountResidentAirApp(false, active)).toBe(false);
  });
});
