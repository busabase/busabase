import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBusabaseClient,
  createBusabaseRpcClient,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  resolveConfig,
} from "./client.js";

/**
 * These cover everything the SDK decides *before* the network: how a base URL is
 * normalised, how config falls back through explicit → env → default, and how
 * auth / space / extra headers are assembled onto each request. A regression
 * here silently mis-targets or mis-authenticates every `busabase-cli` command,
 * so they run with no live backend by capturing the outgoing `Request`.
 */

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://busabase.com/")).toBe("https://busabase.com");
    expect(normalizeBaseUrl("https://busabase.com///")).toBe("https://busabase.com");
  });

  it("strips a redundant /api/v1 suffix (the link re-appends it)", () => {
    expect(normalizeBaseUrl("https://busabase.com/api/v1")).toBe("https://busabase.com");
    expect(normalizeBaseUrl("http://localhost:15419/api/v1/")).toBe("http://localhost:15419");
  });

  it("leaves a plain root untouched", () => {
    expect(normalizeBaseUrl("http://localhost:15419")).toBe("http://localhost:15419");
  });
});

describe("resolveConfig", () => {
  const ENV_KEYS = ["BUSABASE_BASE_URL", "BUSABASE_API_KEY", "BUSABASE_SPACE_ID"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to Busabase Cloud when nothing is set", () => {
    const resolved = resolveConfig();
    expect(resolved.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.spaceId).toBeUndefined();
  });

  it("reads BUSABASE_* env vars", () => {
    process.env.BUSABASE_BASE_URL = "http://localhost:15419";
    process.env.BUSABASE_API_KEY = "sk_env";
    process.env.BUSABASE_SPACE_ID = "spc_env";
    const resolved = resolveConfig();
    expect(resolved).toMatchObject({
      baseUrl: "http://localhost:15419",
      apiKey: "sk_env",
      spaceId: "spc_env",
    });
  });

  it("prefers an explicit field over the env var", () => {
    process.env.BUSABASE_API_KEY = "sk_env";
    process.env.BUSABASE_BASE_URL = "http://env-host";
    const resolved = resolveConfig({ apiKey: "sk_explicit", baseUrl: "http://explicit-host" });
    expect(resolved.apiKey).toBe("sk_explicit");
    expect(resolved.baseUrl).toBe("http://explicit-host");
  });

  it("treats an empty-string env var as unset", () => {
    process.env.BUSABASE_API_KEY = "";
    expect(resolveConfig().apiKey).toBeUndefined();
  });

  it("normalises the resolved base URL", () => {
    expect(resolveConfig({ baseUrl: "https://busabase.com/api/v1/" }).baseUrl).toBe(
      "https://busabase.com",
    );
  });
});

describe("createBusabaseClient request assembly", () => {
  // Capture the outgoing Request without hitting a server; return an empty list
  // so the (GET /api/v1/bases) call the client makes deserialises cleanly.
  const captureFetch = () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { fetchImpl, requests };
  };

  it("targets <baseUrl>/api/v1/<path> using the normalised base URL", async () => {
    const { fetchImpl, requests } = captureFetch();
    const client = createBusabaseClient({
      baseUrl: "http://localhost:15419/api/v1",
      fetch: fetchImpl,
    });
    await client.bases.list();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://localhost:15419/api/v1/bases");
  });

  it("attaches the bearer token and space header when configured", async () => {
    const { fetchImpl, requests } = captureFetch();
    const client = createBusabaseClient({
      baseUrl: "https://busabase.com",
      apiKey: "sk_secret",
      spaceId: "spc_42",
      fetch: fetchImpl,
    });
    await client.bases.list();
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk_secret");
    expect(requests[0]?.headers.get("x-busabase-space")).toBe("spc_42");
  });

  it("sends no auth header for an open local server", async () => {
    const { fetchImpl, requests } = captureFetch();
    const client = createBusabaseClient({ baseUrl: "http://localhost:15419", fetch: fetchImpl });
    await client.bases.list();
    expect(requests[0]?.headers.get("authorization")).toBeNull();
    expect(requests[0]?.headers.get("x-busabase-space")).toBeNull();
  });

  it("merges extra static headers, which win over auth on conflict", async () => {
    const { fetchImpl, requests } = captureFetch();
    const client = createBusabaseClient({
      baseUrl: "https://busabase.com",
      apiKey: "sk_secret",
      headers: { "x-trace-id": "abc", authorization: "Bearer override" },
      fetch: fetchImpl,
    });
    await client.bases.list();
    expect(requests[0]?.headers.get("x-trace-id")).toBe("abc");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer override");
  });

  it("supports an async header factory", async () => {
    const { fetchImpl, requests } = captureFetch();
    const client = createBusabaseClient({
      baseUrl: "https://busabase.com",
      headers: async () => ({ "x-dynamic": "live" }),
      fetch: fetchImpl,
    });
    await client.bases.list();
    expect(requests[0]?.headers.get("x-dynamic")).toBe("live");
  });

  it("sends FileNode Change Requests with Asset metadata through /nodes/change-requests", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({ id: "crq_1", status: "in_review" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = createBusabaseClient({
      baseUrl: "http://localhost:15419",
      fetch: fetchImpl,
    });

    await client.nodes.createChangeRequest({
      message: "Create board plan",
      operations: [
        {
          kind: "create",
          nodeType: "file",
          slug: "board-plan",
          name: "Board Plan",
          metadata: { assetId: "ast_1" },
        },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe("http://localhost:15419/api/v1/nodes/change-requests");
    expect(await requests[0]?.json()).toEqual({
      message: "Create board plan",
      operations: [
        {
          kind: "create",
          metadata: { assetId: "ast_1" },
          name: "Board Plan",
          nodeType: "file",
          slug: "board-plan",
        },
      ],
    });
  });

  it("sends Asset metadata updates through PATCH /assets/{assetId}/metadata", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({ asset: { id: "ast_1", metadata: {} }, usages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = createBusabaseClient({
      baseUrl: "http://localhost:15419",
      fetch: fetchImpl,
    });

    await client.assets.updateMetadata({
      assetId: "ast_1",
      metadata: {
        summary: "AI-readable PDF summary",
        extractedText: "customer: ACME",
      },
      mode: "replace",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.url).toBe("http://localhost:15419/api/v1/assets/ast_1/metadata");
    expect(await requests[0]?.json()).toEqual({
      metadata: {
        summary: "AI-readable PDF summary",
        extractedText: "customer: ACME",
      },
      mode: "replace",
    });
  });

  it("routes FileNode lookups through /files/{nodeId}", async () => {
    const requests: Request[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = createBusabaseClient({
      baseUrl: "http://localhost:15419",
      fetch: fetchImpl,
    });

    await client.files.get({ nodeId: "board-plan" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe("http://localhost:15419/api/v1/files/board-plan");
  });
});

/**
 * createBusabaseRpcClient targets the internal cookie-authenticated /api/rpc
 * transport (the dashboard's own frontend, and — via the bridge documented in
 * apps/busabase/docs/node-types.md — an AirApp running via Nodepod), not the
 * public apiKey-authenticated /api/v1 REST surface createBusabaseClient uses.
 * These tests only cover request assembly; the transport itself (RPCLink →
 * real server → ambient session cookie) was verified end-to-end in a real
 * browser against a real busabase-cloud session — see the AirApp API bridge
 * changelog.
 */
describe("createBusabaseRpcClient request assembly", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when apiBasePath is relative and there is no window (no ambient session outside a browser)", () => {
    expect(() => createBusabaseRpcClient()).toThrow(/must be an absolute URL/);
    expect(() => createBusabaseRpcClient({ apiBasePath: "/api/rpc" })).toThrow(
      /must be an absolute URL/,
    );
  });

  it("resolves a relative apiBasePath against window.location.origin (default targets apps/busabase, unnamespaced)", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:15419" } });
    const { fetchImpl, requests } = createRpcCaptureFetch();
    const client = createBusabaseRpcClient({ fetch: fetchImpl });
    await client.changeRequests.counts();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "http://localhost:15419/api/rpc/changeRequests/counts?data=%7B%7D",
    );
  });

  it("resolves the /__busabase_api__ bridge path, with the /core namespace busabase-cloud mounts its own procedures under", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:15419" } });
    const { fetchImpl, requests } = createRpcCaptureFetch();
    const client = createBusabaseRpcClient({
      apiBasePath: "/__busabase_api__/api/rpc/core",
      fetch: fetchImpl,
    });
    await client.changeRequests.counts();
    expect(requests[0]?.url).toBe(
      "http://localhost:15419/__busabase_api__/api/rpc/core/changeRequests/counts?data=%7B%7D",
    );
  });

  it("accepts an absolute URL without requiring window", async () => {
    const { fetchImpl, requests } = createRpcCaptureFetch();
    const client = createBusabaseRpcClient({
      apiBasePath: "https://busabase.com/api/rpc",
      fetch: fetchImpl,
    });
    await client.changeRequests.counts();
    expect(requests[0]?.url).toBe("https://busabase.com/api/rpc/changeRequests/counts?data=%7B%7D");
  });

  it("sends no authorization or space header — auth is purely the ambient cookie", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:15419" } });
    const { fetchImpl, requests } = createRpcCaptureFetch();
    const client = createBusabaseRpcClient({ fetch: fetchImpl });
    await client.changeRequests.counts();
    expect(requests[0]?.headers.get("authorization")).toBeNull();
    expect(requests[0]?.headers.get("x-busabase-space")).toBeNull();
  });

  it("merges extra headers", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:15419" } });
    const { fetchImpl, requests } = createRpcCaptureFetch();
    const client = createBusabaseRpcClient({
      headers: { "x-demo-mode": "readme" },
      fetch: fetchImpl,
    });
    await client.changeRequests.counts();
    expect(requests[0]?.headers.get("x-demo-mode")).toBe("readme");
  });
});

// changeRequests.counts() is a no-input RPC procedure — RPCLink still POSTs an
// empty JSON body for it, matching what the real dashboard sends.
function createRpcCaptureFetch() {
  const requests: Request[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return new Response(JSON.stringify({ json: { review: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}
