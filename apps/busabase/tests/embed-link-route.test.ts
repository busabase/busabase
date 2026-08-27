import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveEmbedLink: vi.fn() }));

vi.mock("busabase-core/domains/embed-links/logic", () => ({
  resolveEmbedLink: mocks.resolveEmbedLink,
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
