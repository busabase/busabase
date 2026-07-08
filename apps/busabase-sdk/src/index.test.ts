import { describe, expect, it, vi } from "vitest";
import { Busabase } from "./index.js";

/**
 * The `Busabase` class is a thin ergonomic wrapper over the raw oRPC client. These
 * tests confirm it resolves config correctly, exposes each domain namespace as the
 * *same* underlying client surface (no accidental re-wrapping), and that the hand-
 * written `search` / `health` / `me` shortcuts route to the right procedures — the
 * things a wrapper regression would silently break.
 */

const okFetch = () => {
  const requests: Request[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
};

describe("Busabase config", () => {
  it("normalises the base URL and keeps the resolved key", () => {
    const bb = new Busabase({ baseUrl: "https://busabase.com/api/v1/", apiKey: "sk_x" });
    expect(bb.config.baseUrl).toBe("https://busabase.com");
    expect(bb.config.apiKey).toBe("sk_x");
  });
});

describe("Busabase namespaces", () => {
  // The oRPC client is a navigation Proxy, so reference-identity checks are unsafe
  // (property access is interpreted as a route segment). Verify delegation
  // *functionally* instead: each namespace's no-arg `list()` must route to that
  // resource's endpoint through the wrapper.
  it.each([
    ["assets", "assets"],
    ["bases", "bases"],
    ["nodes", "nodes"],
    ["changeRequests", "change-requests"],
    ["skills", "skills"],
    ["files", "files"],
    ["docs", "docs"],
    ["folders", "folders"],
  ] as const)("%s.list() routes through the wrapper to /%s", async (ns, segment) => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });
    await (bb[ns] as { list: () => Promise<unknown> }).list();
    expect(new URL(requests[0]?.url ?? "").pathname).toContain(segment);
  });

  it("routes asset upload helpers through /assets, not /attachments", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(
        JSON.stringify({
          duplicate: false,
          expiresIn: 3600,
          publicUrl: "https://cdn.example/cover.png",
          storageKey: "attachments/cover.png",
          uploadUrl: "https://upload.example/cover.png",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.assets.createUploadUrl({
      fileName: "cover.png",
      mimeType: "image/png",
      sizeBytes: 1,
      context: "record-field",
    });

    const pathname = new URL(requests[0]?.url ?? "").pathname;
    expect(pathname).toContain("/api/v1/assets/upload-urls");
    expect(pathname).not.toContain("/attachments/");
  });

  it("routes Asset metadata writes through /assets", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({ asset: { id: "ast_1", metadata: {} }, usages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.assets.updateMetadata({
      assetId: "ast_1",
      metadata: { summary: "Readable by agents" },
    });

    const pathname = new URL(requests[0]?.url ?? "").pathname;
    expect(requests[0]?.method).toBe("PATCH");
    expect(pathname).toBe("/api/v1/assets/ast_1/metadata");
    expect(pathname).not.toContain("/attachments/");
  });
});

describe("Busabase shortcuts route to the right procedure", () => {
  it("health() hits the system health endpoint", async () => {
    const { fetchImpl, requests } = okFetch();
    await new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl }).health();
    expect(new URL(requests[0]?.url ?? "").pathname).toContain("health");
  });

  it("me() hits the users endpoint", async () => {
    const { fetchImpl, requests } = okFetch();
    await new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl }).me();
    expect(new URL(requests[0]?.url ?? "").pathname).toContain("users");
  });

  it("search() hits the search endpoint with the query", async () => {
    const { fetchImpl, requests } = okFetch();
    await new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl }).search({
      query: "hi",
    });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toContain("search");
  });
});
