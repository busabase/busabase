import { describe, expect, it } from "vitest";
import {
  buildDashboardUrl,
  getDashboardBasePath,
  getLegacyDashboardRedirect,
} from "../src/lib/dashboard-routes";

describe("dashboard routes", () => {
  it("builds canonical root-host routes with the local space id", () => {
    expect(getDashboardBasePath()).toBe("/dashboard/local");
    expect(buildDashboardUrl("/base/blog?view=drafts#top")).toBe(
      "/dashboard/local/base/blog?view=drafts#top",
    );
    expect(buildDashboardUrl("/")).toBe("/dashboard/local/inbox");
  });

  it("redirects legacy and incomplete root-host dashboard paths", () => {
    expect(getLegacyDashboardRedirect("/dashboard")).toBe("/dashboard/local/inbox");
    expect(getLegacyDashboardRedirect("/dashboard/inbox")).toBe("/dashboard/local/inbox");
    expect(getLegacyDashboardRedirect("/dashboard/base/blog")).toBe("/dashboard/local/base/blog");
    expect(getLegacyDashboardRedirect("/dashboard/local")).toBe("/dashboard/local/inbox");
    expect(getLegacyDashboardRedirect("/dashboard/local/inbox")).toBeNull();
  });
});
