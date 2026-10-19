import { describe, expect, it } from "vitest";
import { dashboardNodeShareUrl } from "./share-url";

describe("dashboardNodeShareUrl", () => {
  it("uses the root dashboard space and stable record id", () => {
    expect(
      dashboardNodeShareUrl({
        currentHref: "https://busabase.com/dashboard/space-1/base/old?view=grid",
        nodeType: "base",
        nodeSlug: "nod_devices",
        extraSegments: ["rec/1"],
      }),
    ).toBe("https://busabase.com/dashboard/space-1/base/nod_devices/rec%2F1");
  });

  it("keeps the short workspace subdomain path", () => {
    expect(
      dashboardNodeShareUrl({
        currentHref: "https://team.busabase.com/base/devices/rec-1?view=grid",
        spaceId: "internal-space-id",
        nodeType: "base",
        nodeSlug: "devices",
        extraSegments: ["rec-1"],
      }),
    ).toBe("https://team.busabase.com/base/devices/rec-1");
  });
});
