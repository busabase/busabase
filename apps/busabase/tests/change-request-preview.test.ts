import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  renderDashboardPage: vi.fn(async () => ({ type: "dashboard-preview" })),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("~/app/dashboard/dashboard-page", () => ({
  renderDashboardPage: mocks.renderDashboardPage,
}));

import ChangeRequestPreviewPage from "../src/app/embed/change-request/[changeRequestId]/page";
import {
  CHANGE_REQUEST_PREVIEW_ID_PATTERN,
  getChangeRequestPreviewDashboardPath,
} from "../src/lib/change-request-preview";

describe("Change Request preview page", () => {
  it("renders the existing dashboard detail route in chromeless read-only mode", async () => {
    await ChangeRequestPreviewPage({
      params: Promise.resolve({ changeRequestId: "crq_seed_blog_update" }),
    });

    expect(mocks.renderDashboardPage).toHaveBeenCalledWith("/inbox/crq_seed_blog_update", {
      chromeless: true,
      readOnlyChangeRequestPreview: true,
    });
  });

  it("encodes ids through the shared dashboard path helper", () => {
    expect(getChangeRequestPreviewDashboardPath("crq_preview_123")).toBe("/inbox/crq_preview_123");
    expect(CHANGE_REQUEST_PREVIEW_ID_PATTERN.test("not-valid")).toBe(false);
  });

  it("rejects invalid ids before rendering the dashboard", async () => {
    await expect(
      ChangeRequestPreviewPage({ params: Promise.resolve({ changeRequestId: "not-valid" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("Change Request preview headers", () => {
  it("allows cross-origin frames without enabling caching or indexing", async () => {
    const { changeRequestPreviewHeaders } = await import("../next.config.mjs");
    const headers = new Map(
      changeRequestPreviewHeaders.map(({ key, value }) => [key.toLowerCase(), value]),
    );

    expect(headers.get("content-security-policy")).toBe("frame-ancestors *");
    expect(headers.get("cache-control")).toContain("no-store");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(headers.has("x-frame-options")).toBe(false);
  });
});

describe("Change Request preview SPA location", () => {
  it("locks the embedded dashboard to its initial inbox route after hydration", () => {
    const dashboardClientSource = readFileSync(
      new URL("../src/app/dashboard/client.tsx", import.meta.url),
      "utf8",
    );
    const spaWrapperSource = readFileSync(
      new URL("../src/components/spa/spa-wrapper.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardClientSource).toContain("lockInitialPath={readOnlyChangeRequestPreview}");
    expect(spaWrapperSource).toContain("memoryLocation({");
    expect(spaWrapperSource).toContain("hook={lockInitialPath ? lockedLocation.hook : undefined}");
  });
});
