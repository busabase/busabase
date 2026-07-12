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
    ["webhooks", "webhooks"],
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

describe("Busabase.putText", () => {
  // Drive Grep Retrieval: putText hides the inline-vs-presigned branch behind one
  // call. Wire shapes below (assetId as a URL path param, not a body field) were
  // confirmed against the real oRPC client before writing these assertions.
  it("writes small text inline via a single PUT", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(
        JSON.stringify({
          assetId: "ast_1",
          textStatus: "present",
          lineCount: 1,
          charCount: 12,
          byteCount: 12,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    const result = await bb.putText("ast_1", "small string");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("PUT");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/assets/ast_1/text");
    expect(await requests[0]?.clone().json()).toEqual({ text: "small string" });
    expect(result.textStatus).toBe("present");
  });

  it("writes large text through the presigned upload flow (createTextUploadUrl -> PUT -> putText)", async () => {
    const largeText = "a".repeat(1024 * 1024 + 100); // exceeds the 1MB inline cap
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      if (request.url === "https://upload.example/large.txt") {
        return new Response(null, { status: 200 });
      }
      if (request.url.endsWith("/api/v1/assets/text/upload-urls")) {
        return new Response(
          JSON.stringify({
            uploadUrl: "https://upload.example/large.txt",
            storageKey: "asset-texts/pending/large.txt",
            expiresIn: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          assetId: "ast_1",
          textStatus: "present",
          lineCount: 1,
          charCount: largeText.length,
          byteCount: largeText.length,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    const result = await bb.putText("ast_1", largeText);

    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ["POST", "http://localhost:15419/api/v1/assets/text/upload-urls"],
      ["PUT", "https://upload.example/large.txt"],
      ["PUT", "http://localhost:15419/api/v1/assets/ast_1/text"],
    ]);
    expect(await requests[0]?.clone().json()).toEqual({
      assetId: "ast_1",
      sizeBytes: largeText.length,
    });
    // Middle call is a raw byte PUT (text/plain), not JSON — assert the real bytes went out.
    expect((await requests[1]?.clone().text())?.length).toBe(largeText.length);
    expect(await requests[2]?.clone().json()).toEqual({
      storageKey: "asset-texts/pending/large.txt",
    });
    expect(result.textStatus).toBe("present");
  });

  it("falls back to the global fetch for the presigned PUT when no config.fetch is given", async () => {
    // putText's presigned-upload PUT uses `this.config.fetch ?? fetch` — this test
    // exercises the `?? fetch` branch specifically (every other test here supplies
    // config.fetch, which would leave that fallback permanently unexercised).
    const largeText = "c".repeat(1024 * 1024 + 100);
    const originalFetch = global.fetch;
    const calls: Array<{ method: string; url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: request.method, url: request.url });
      if (request.url === "https://upload.example/large.txt") {
        return new Response(null, { status: 200 });
      }
      if (request.url.endsWith("/api/v1/assets/text/upload-urls")) {
        return new Response(
          JSON.stringify({
            uploadUrl: "https://upload.example/large.txt",
            storageKey: "asset-texts/pending/large.txt",
            expiresIn: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          assetId: "ast_1",
          textStatus: "present",
          lineCount: 1,
          charCount: largeText.length,
          byteCount: largeText.length,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      // No `fetch` in config — client transport still needs one, so we still pass
      // fetchImpl to the oRPC client construction path via config.fetch... except
      // here we intentionally omit it so `this.config.fetch` is undefined and the
      // `?? fetch` fallback resolves to the global we just patched.
      const bb = new Busabase({ baseUrl: "http://localhost:15419" });
      const result = await bb.putText("ast_1", largeText);
      expect(calls.map((c) => [c.method, c.url])).toEqual([
        ["POST", "http://localhost:15419/api/v1/assets/text/upload-urls"],
        ["PUT", "https://upload.example/large.txt"],
        ["PUT", "http://localhost:15419/api/v1/assets/ast_1/text"],
      ]);
      expect(result.textStatus).toBe("present");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws a descriptive error when the presigned upload PUT fails (no silent failure)", async () => {
    const largeText = "b".repeat(1024 * 1024 + 100);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "https://upload.example/large.txt") {
        return new Response("disk full", { status: 500, statusText: "Internal Server Error" });
      }
      return new Response(
        JSON.stringify({
          uploadUrl: "https://upload.example/large.txt",
          storageKey: "asset-texts/pending/large.txt",
          expiresIn: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await expect(bb.putText("ast_1", largeText)).rejects.toThrow(
      "putText: presigned upload failed (500 Internal Server Error): disk full",
    );
  });

  it("throws without a trailing colon when the failed presigned PUT has an empty body", async () => {
    const largeText = "d".repeat(1024 * 1024 + 100);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "https://upload.example/large.txt") {
        return new Response(null, { status: 503, statusText: "Service Unavailable" });
      }
      return new Response(
        JSON.stringify({
          uploadUrl: "https://upload.example/large.txt",
          storageKey: "asset-texts/pending/large.txt",
          expiresIn: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    const error = await bb.putText("ast_1", largeText).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "putText: presigned upload failed (503 Service Unavailable)",
    );
  });
});

describe("Busabase.grep() (Unified Grep) routes through the typed client", () => {
  it("grep() posts to /grep — proves the SDK wrapper actually reaches the new top-level endpoint", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.grep({ pattern: "TODO", sources: ["docs"] });

    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/grep");
    expect(await requests[0]?.clone().json()).toEqual({ pattern: "TODO", sources: ["docs"] });
  });
});

describe("Busabase.assets.grep / readTextLines route through the typed client with zero wrapper code", () => {
  // No SDK wrapper exists for these two — they're reached directly via
  // `bb.assets.<method>`. That's by design (see index.ts), but it also means a
  // contract/router typo could silently break them with nothing else catching it.
  it("assets.grep() posts to /assets/grep", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.assets.grep({ pattern: "TODO" });

    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/assets/grep");
    expect(await requests[0]?.clone().json()).toEqual({ pattern: "TODO" });
  });

  it("assets.readTextLines() gets /assets/{assetId}/text/lines with the range as query params", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.assets.readTextLines({ assetId: "ast_1", startLine: 10, endLine: 20 });

    expect(requests[0]?.method).toBe("GET");
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/assets/ast_1/text/lines");
    expect(url.searchParams.get("startLine")).toBe("10");
    expect(url.searchParams.get("endLine")).toBe("20");
  });

  it("assets.editContent() posts to /assets/{assetId}/edit-content — also no SDK wrapper", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.assets.editContent({
      assetId: "ast_1",
      edits: [{ oldString: "ACME Corp", newString: "Umbrella Inc" }],
    });

    expect(requests[0]?.method).toBe("POST");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/assets/ast_1/edit-content");
    expect(await requests[0]?.clone().json()).toEqual({
      edits: [{ oldString: "ACME Corp", newString: "Umbrella Inc" }],
    });
  });
});

describe("Busabase webhooks domain (via the bb.webhooks getter) routes correctly", () => {
  it("create() POSTs the full rule payload to /webhooks", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.webhooks.create({
      name: "notify on new posts",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: "https://example.com/hook" },
      enabled: true,
    });

    const request = requests[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe("/api/v1/webhooks");
    expect(await request?.clone().json()).toMatchObject({ name: "notify on new posts" });
  });

  it("get()/delete() hit /webhooks/{id} with GET/DELETE", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.webhooks.get({ id: "whk_1" });
    await bb.webhooks.delete({ id: "whk_1" });

    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["GET", "/api/v1/webhooks/whk_1"],
      ["DELETE", "/api/v1/webhooks/whk_1"],
    ]);
  });

  it("update() PUTs to /webhooks/{id}", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.webhooks.update({
      id: "whk_1",
      name: "renamed",
      eventType: "record.created",
      baseId: null,
      actionKind: "webhook",
      config: { targetUrl: "https://example.com/hook" },
      enabled: false,
    });

    const request = requests[0];
    expect(request?.method).toBe("PUT");
    expect(new URL(request?.url ?? "").pathname).toBe("/api/v1/webhooks/whk_1");
  });

  it("deliveries() GETs /webhooks/{ruleId}/deliveries with limit as a query param", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.webhooks.deliveries({ ruleId: "whk_1", limit: 5 });

    const url = new URL(requests[0]?.url ?? "");
    expect(requests[0]?.method).toBe("GET");
    expect(url.pathname).toBe("/api/v1/webhooks/whk_1/deliveries");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("testFire() POSTs to /webhooks/{id}/test-fire with no body", async () => {
    const { fetchImpl, requests } = okFetch();
    const bb = new Busabase({ baseUrl: "http://localhost:15419", fetch: fetchImpl });

    await bb.webhooks.testFire({ id: "whk_1" });

    const request = requests[0];
    expect(request?.method).toBe("POST");
    expect(new URL(request?.url ?? "").pathname).toBe("/api/v1/webhooks/whk_1/test-fire");
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
