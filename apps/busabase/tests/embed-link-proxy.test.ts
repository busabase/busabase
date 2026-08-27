import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLegacyDashboardRedirect: vi.fn(),
  nodepodProxy: vi.fn(),
  resolveEmbedCapabilityMetadata: vi.fn(),
  resolveEmbedFramePolicy: vi.fn(),
}));

vi.mock("@scelar/nodepod/next", () => ({ nodepodProxy: mocks.nodepodProxy }));
vi.mock("busabase-core/domains/embed-links/logic", () => ({
  resolveEmbedCapabilityMetadata: mocks.resolveEmbedCapabilityMetadata,
  resolveEmbedFramePolicy: mocks.resolveEmbedFramePolicy,
}));
vi.mock("~/lib/dashboard-routes", () => ({
  getLegacyDashboardRedirect: mocks.getLegacyDashboardRedirect,
}));

import { config, proxy } from "../src/proxy";

const publicId = "emb_Abcdefghijklmno1";
const secret = "s".repeat(43);

describe("Desktop embed proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLegacyDashboardRedirect.mockReturnValue(null);
    mocks.nodepodProxy.mockResolvedValue(null);
    mocks.resolveEmbedCapabilityMetadata.mockResolvedValue({
      expiresAt: new Date("2026-08-27T14:30:00.000Z"),
      framePolicy: {
        mode: "origins",
        allowedOrigins: ["https://viewer.example"],
      },
    });
    mocks.resolveEmbedFramePolicy.mockResolvedValue({
      mode: "origins",
      allowedOrigins: ["https://viewer.example"],
    });
  });

  it("exchanges a top-level token for an HttpOnly cookie and scoped CSP", async () => {
    const response = await proxy(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}`),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost:15419/embed/${publicId}`);
    expect(setCookie).toContain(`${publicId}.${secret}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("Expires=Thu, 27 Aug 2026 14:30:00 GMT");
    expect(setCookie).not.toContain("Max-Age");
    expect(setCookie).toContain(`Path=/embed/${publicId}`);
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).not.toContain("secure");
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors https://viewer.example",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.resolveEmbedCapabilityMetadata).toHaveBeenCalledWith(publicId, secret);
  });

  it("marks the capability cookie secure when the external request is HTTPS", async () => {
    const response = await proxy(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}`, {
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain("secure");
  });

  it("does not persist an invalid or expired capability", async () => {
    mocks.resolveEmbedCapabilityMetadata.mockResolvedValue(null);

    const response = await proxy(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("keeps the existing route coverage while adding public embeds", () => {
    expect(config.matcher).toEqual([
      "/dashboard/:path*",
      "/api/:path*",
      "/embed/:path*",
      "/__sw__.js",
    ]);
  });
});
