import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveEmbedLink: vi.fn(), resolveExpiredEmbedLink: vi.fn() }));

vi.mock("busabase-core/domains/embed-links/logic", () => ({
  resolveEmbedLink: mocks.resolveEmbedLink,
  resolveExpiredEmbedLink: mocks.resolveExpiredEmbedLink,
}));

import { GET } from "../src/app/(public)/embed/[publicId]/route";

const publicId = "emb_Abcdefghijklmno1";
const secret = "s".repeat(43);
const resolved = {
  id: publicId,
  spaceId: "local",
  type: "node" as const,
  typeId: "nod_1",
  targetName: "Runbook",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  framePolicy: { mode: "origins" as const, allowedOrigins: ["https://viewer.example"] },
  detail: { type: "doc", doc: { body: "# Runbook", node: { id: "nod_1" } } },
};

describe("Desktop embed capability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveEmbedLink.mockResolvedValue(resolved);
    mocks.resolveExpiredEmbedLink.mockResolvedValue(null);
  });

  it("says an expired link expired, framed by the link's own policy", async () => {
    mocks.resolveEmbedLink.mockResolvedValue(null);
    mocks.resolveExpiredEmbedLink.mockResolvedValue({
      type: "node",
      framePolicy: resolved.framePolicy,
    });
    const response = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`),
      { params: Promise.resolve({ publicId }) },
    );
    const html = await response.text();

    expect(response.status).toBe(410);
    expect(html).toContain("Link expired");
    expect(html).not.toContain("Content unavailable");

    const zh = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`, {
        headers: { "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
      }),
      { params: Promise.resolve({ publicId }) },
    );
    expect(await zh.text()).toContain("链接已过期");
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors https://viewer.example",
    );
  });

  it("keeps any other failure an anonymous 'Content unavailable'", async () => {
    mocks.resolveEmbedLink.mockResolvedValue(null);
    const response = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`),
      { params: Promise.resolve({ publicId }) },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Content unavailable");

    const zh = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`, {
        headers: { "accept-language": "zh-TW,zh;q=0.9" },
      }),
      { params: Promise.resolve({ publicId }) },
    );
    expect(await zh.text()).toContain("內容不可用");
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("rejects malformed public ids before reading storage", async () => {
    const response = await GET(new NextRequest("http://localhost:15419/embed/not-valid"), {
      params: Promise.resolve({ publicId: "not-valid" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.resolveEmbedLink).not.toHaveBeenCalled();
  });

  it("renders iframe requests directly with no-store and no-referrer headers", async () => {
    const response = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`),
      { params: Promise.resolve({ publicId }) },
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(html).toContain("<title>Runbook</title>");
    expect(html).toContain("<h1>Runbook</h1>");
  });

  it("dispatches AirApp embeds to the shared runtime route", async () => {
    mocks.resolveEmbedLink.mockResolvedValue({
      ...resolved,
      detail: { type: "airapp", airapp: { node: { id: "nod_1", name: "Runbook" } } },
    });
    const response = await GET(
      new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`),
      { params: Promise.resolve({ publicId }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `http://localhost:15419/embed/${publicId}/airapp?token=${secret}&view=iframe`,
    );
  });

  it.each(["change-request", "record-detail"] as const)(
    "dispatches a %s embed to its target page",
    async (type) => {
      mocks.resolveEmbedLink.mockResolvedValue({
        id: publicId,
        spaceId: "local",
        type,
        typeId: "target_1",
        targetName: "Review target",
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        framePolicy: { mode: "anywhere", allowedOrigins: [] },
      });
      const response = await GET(
        new NextRequest(`http://localhost:15419/embed/${publicId}?token=${secret}&view=iframe`),
        { params: Promise.resolve({ publicId }) },
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `http://localhost:15419/embed/${publicId}/${type}?token=${secret}&view=iframe`,
      );
    },
  );
});
