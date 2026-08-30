import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBusabaseAirAppLocalGateway, describeBusabaseAirAppRuntime } from "./airapp-node.js";
import {
  loadBusabaseAirAppDynamicClientId,
  loadBusabaseAirAppOAuthCredential,
  storeBusabaseAirAppOAuthCredential,
} from "./oauth-node.js";

const APP_ID = "test-airapp";
let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "busabase-airapp-gateway-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

const tokenSet = () => ({
  accessToken: "bso_access",
  refreshToken: "bsr_refresh",
  expiresIn: 3600,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  scope: ["api"],
  tokenType: "Bearer",
});

const request = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1:3111${path}`, init);

const authBody = (spaces: Array<{ id: string; name: string }>, targeted?: string) => ({
  space: spaces.find((space) => space.id === targeted) || spaces[0],
  spaces,
  user: { id: "usr_1", name: "Kelly", email: "kelly@example.com", image: null },
  member: { userId: "usr_1", spaceId: targeted || spaces[0]?.id || "", role: "owner" },
});

const connectedGateway = (
  spaces: Array<{ id: string; name: string }>,
  options: { selectedSpace?: { id: string; name: string }; proxyStatus?: number } = {},
) => {
  storeBusabaseAirAppOAuthCredential(
    {
      appId: APP_ID,
      baseUrl: "https://busabase.example.com",
      tokenSet: tokenSet(),
      selectedSpace: options.selectedSpace,
    },
    { rootDir },
  );
  const requests: Request[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const upstream = input instanceof Request ? input : new Request(input, init);
    requests.push(upstream);
    const url = new URL(upstream.url);
    if (url.pathname === "/api/v1/auth") {
      const targeted = upstream.headers.get("x-busabase-space") || undefined;
      if (targeted && !spaces.some((space) => space.id === targeted)) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      return Response.json(authBody(spaces, targeted));
    }
    return Response.json(
      { ok: true, space: upstream.headers.get("x-busabase-space") },
      { status: options.proxyStatus || 200 },
    );
  });
  return {
    gateway: createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    }),
    requests,
  };
};

describe("local AirApp gateway readiness", () => {
  it("reports connection readiness without a credential", async () => {
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      environment: {},
    });
    await expect(gateway.status()).resolves.toMatchObject({
      connected: false,
      readiness: "needs_connection",
      action: "connect",
      reason: "CONNECTION_REQUIRED",
    });
  });

  it("reports no-space, auto-selects one Space, and requires an explicit multi-Space choice", async () => {
    const empty = connectedGateway([]).gateway;
    await expect(empty.status()).resolves.toMatchObject({
      readiness: "needs_space",
      spaces: [],
      selectedSpace: null,
    });

    const single = connectedGateway([{ id: "spc_1", name: "Solo" }]).gateway;
    await expect(single.status()).resolves.toMatchObject({
      readiness: "ready",
      selectedSpace: { id: "spc_1", name: "Solo" },
    });
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })?.selectedSpace).toEqual({
      id: "spc_1",
      name: "Solo",
    });

    const multiple = connectedGateway([
      { id: "spc_1", name: "Acme" },
      { id: "spc_2", name: "Globex" },
    ]).gateway;
    await expect(multiple.status()).resolves.toMatchObject({
      readiness: "needs_space",
      action: "select_space",
      reason: "SPACE_SELECTION_REQUIRED",
      selectedSpace: null,
    });
  });

  it("clears a stale selection and validates a new selection", async () => {
    const { gateway } = connectedGateway(
      [
        { id: "spc_1", name: "Acme" },
        { id: "spc_2", name: "Globex" },
      ],
      { selectedSpace: { id: "spc_old", name: "Old" } },
    );
    await expect(gateway.status()).resolves.toMatchObject({
      readiness: "needs_space",
      selectedSpace: null,
    });

    const denied = await gateway.selectSpace(
      request("/auth/space", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3111",
        },
        body: JSON.stringify({ space_id: "spc_bad" }),
      }),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      data: { reason: "SPACE_NOT_ALLOWED" },
    });

    const selected = await gateway.selectSpace(
      request("/auth/space", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3111",
        },
        body: JSON.stringify({ space_id: "spc_2" }),
      }),
    );
    expect(selected.status).toBe(200);
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })?.selectedSpace).toEqual({
      id: "spc_2",
      name: "Globex",
    });
  });
});

describe("local AirApp gateway OAuth", () => {
  it("keeps the shared client for loopback callbacks", async () => {
    const requests: Request[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = input instanceof Request ? input : new Request(input, init);
      requests.push(upstream);
      return new Response(null, { status: 302 });
    });
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const response = await gateway.start(
      request("/auth/start", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3111" },
      }),
    );
    expect(response.status).toBe(303);
    const authorize = new URL(requests[0]?.url || "");
    expect(authorize.pathname).toBe("/api/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("busabase-airapp");
    expect(requests).toHaveLength(1);
  });

  it("registers and uses an exact client for an HTTPS callback", async () => {
    const requests: Request[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = input instanceof Request ? input : new Request(input, init);
      requests.push(upstream);
      const url = new URL(upstream.url);
      if (url.pathname === "/api/oauth/register") {
        const body = (await upstream.json()) as { client_kind: string; redirect_uris: string[] };
        expect(body.client_kind).toBe("airapp");
        expect(body.redirect_uris).toEqual(["https://preview.example/auth/callback"]);
        return Response.json(
          { client_id: "airapp_client_dynamic", redirect_uris: body.redirect_uris, scope: "api" },
          { status: 201 },
        );
      }
      if (url.pathname === "/api/oauth/token") {
        const body = new URLSearchParams(await upstream.text());
        expect(body.get("client_id")).toBe("airapp_client_dynamic");
        expect(body.get("redirect_uri")).toBe("https://preview.example/auth/callback");
        return Response.json({
          access_token: "dynamic_access",
          refresh_token: "dynamic_refresh",
          expires_in: 3600,
          scope: "api",
          token_type: "Bearer",
        });
      }
      return new Response(null, { status: 302 });
    });
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const response = await gateway.start(
      new Request("https://preview.example/auth/start", {
        method: "POST",
        headers: { origin: "https://preview.example" },
      }),
    );
    expect(response.status).toBe(303);
    const authorize = new URL(requests[1]?.url || "");
    expect(authorize.pathname).toBe("/api/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("airapp_client_dynamic");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://preview.example/auth/callback",
    );
    const callback = await gateway.callback(
      new Request(
        `https://preview.example/auth/callback?code=code_1&state=${authorize.searchParams.get("state")}&iss=${encodeURIComponent("https://busabase.com")}`,
      ),
    );
    expect(callback.status).toBe(303);
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toMatchObject({
      clientId: "airapp_client_dynamic",
      accessToken: "dynamic_access",
      refreshToken: "dynamic_refresh",
    });
  });

  it("uses a corroborated forwarded origin for dynamic OAuth behind a preview proxy", async () => {
    const publicOrigin = "https://3111-preview.dev.budaapps.com";
    const requests: Request[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = input instanceof Request ? input : new Request(input, init);
      requests.push(upstream);
      const url = new URL(upstream.url);
      if (url.pathname === "/api/oauth/register") {
        const body = (await upstream.json()) as { redirect_uris: string[] };
        expect(body.redirect_uris).toEqual([`${publicOrigin}/auth/callback`]);
        return Response.json(
          { client_id: "airapp_client_proxy", redirect_uris: body.redirect_uris, scope: "api" },
          { status: 201 },
        );
      }
      if (url.pathname === "/api/oauth/token") {
        const body = new URLSearchParams(await upstream.text());
        expect(body.get("redirect_uri")).toBe(`${publicOrigin}/auth/callback`);
        return Response.json({
          access_token: "proxy_access",
          refresh_token: "proxy_refresh",
          expires_in: 3600,
          scope: "api",
          token_type: "Bearer",
        });
      }
      return new Response(null, { status: 302 });
    });
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const forwardedHeaders = {
      "x-forwarded-host": new URL(publicOrigin).host,
      "x-forwarded-proto": "https",
    };
    const response = await gateway.start(
      request("/auth/start", {
        method: "POST",
        headers: { ...forwardedHeaders, origin: publicOrigin },
      }),
    );
    expect(response.status).toBe(303);
    const authorize = new URL(requests[1]?.url || "");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${publicOrigin}/auth/callback`);

    const callback = await gateway.callback(
      request(
        `/auth/callback?code=code_1&state=${authorize.searchParams.get("state")}&iss=${encodeURIComponent("https://busabase.com")}`,
        { headers: forwardedHeaders },
      ),
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(`${publicOrigin}/`);
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toMatchObject({
      clientId: "airapp_client_proxy",
      accessToken: "proxy_access",
    });
  });

  it("rejects a browser Origin that disagrees with forwarded proxy headers", async () => {
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      environment: {},
    });
    const response = await gateway.start(
      request("/auth/start", {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "x-forwarded-host": "preview.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("oauth_error=Request+origin+did+not+match");
  });

  it("keeps the shared client for an IPv6 loopback callback", async () => {
    const requests: Request[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(input instanceof Request ? input : new Request(input, init));
      return new Response(null, { status: 302 });
    });
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const response = await gateway.start(
      new Request("http://[::1]:3111/auth/start", {
        method: "POST",
        headers: { origin: "http://[::1]:3111" },
      }),
    );
    expect(response.status).toBe(303);
    const authorize = new URL(requests[0]?.url || "");
    expect(authorize.pathname).toBe("/api/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("busabase-airapp");
    expect(requests).toHaveLength(1);
  });

  it("reuses the persisted dynamic client instead of re-registering after a restart", async () => {
    let registrations = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = input instanceof Request ? input : new Request(input, init);
      if (new URL(upstream.url).pathname === "/api/oauth/register") {
        registrations += 1;
        const body = (await upstream.json()) as { redirect_uris: string[] };
        return Response.json(
          {
            client_id: `airapp_client_${registrations}`,
            redirect_uris: body.redirect_uris,
            scope: "api",
          },
          { status: 201 },
        );
      }
      return new Response(null, { status: 302 });
    });
    const startOnce = async () => {
      // A fresh gateway each time stands in for a restarted AirApp process.
      const gateway = createBusabaseAirAppLocalGateway({
        appId: APP_ID,
        credentialStore: { rootDir },
        fetch: fetchMock as unknown as typeof fetch,
      });
      const response = await gateway.start(
        new Request("https://preview.example/auth/start", {
          method: "POST",
          headers: { origin: "https://preview.example" },
        }),
      );
      expect(response.status).toBe(303);
    };

    await startOnce();
    await startOnce();
    await startOnce();

    expect(registrations).toBe(1);
    expect(
      loadBusabaseAirAppDynamicClientId(
        {
          appId: APP_ID,
          baseUrl: "https://busabase.com",
          redirectUri: "https://preview.example/auth/callback",
        },
        { rootDir },
      ),
    ).toBe("airapp_client_1");
  });

  it("re-registers when the stored dynamic client is no longer accepted", async () => {
    let registrations = 0;
    let firstClientExpired = false;
    const authorizedClientIds: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const upstream = input instanceof Request ? input : new Request(input, init);
      const url = new URL(upstream.url);
      if (url.pathname === "/api/oauth/register") {
        registrations += 1;
        const body = (await upstream.json()) as { redirect_uris: string[] };
        return Response.json(
          {
            client_id: `airapp_client_${registrations}`,
            redirect_uris: body.redirect_uris,
            scope: "api",
          },
          { status: 201 },
        );
      }
      const clientId = url.searchParams.get("client_id") || "";
      authorizedClientIds.push(clientId);
      const expired = clientId === "airapp_client_1" && firstClientExpired;
      return new Response(null, { status: expired ? 400 : 302 });
    });
    const startOnce = async () => {
      const gateway = createBusabaseAirAppLocalGateway({
        appId: APP_ID,
        credentialStore: { rootDir },
        fetch: fetchMock as unknown as typeof fetch,
      });
      return gateway.start(
        new Request("https://preview.example/auth/start", {
          method: "POST",
          headers: { origin: "https://preview.example" },
        }),
      );
    };

    // First connect registers `airapp_client_1` while it is still valid.
    expect((await startOnce()).status).toBe(303);
    expect(authorizedClientIds).toEqual(["airapp_client_1"]);

    // It later expires server-side; the next connect reuses the stored id, is rejected,
    // re-registers, and recovers without user action.
    firstClientExpired = true;
    const recovered = await startOnce();
    expect(recovered.status).toBe(303);
    expect(recovered.headers.get("location")).toContain("client_id=airapp_client_2");
    expect(registrations).toBe(2);
    expect(authorizedClientIds).toEqual(["airapp_client_1", "airapp_client_1", "airapp_client_2"]);
  });
});

describe("local AirApp gateway proxy", () => {
  it("blocks resource access until Space selection", async () => {
    const { gateway, requests } = connectedGateway([
      { id: "spc_1", name: "Acme" },
      { id: "spc_2", name: "Globex" },
    ]);
    const response = await gateway.proxy(request("/api/v1/bases"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONFLICT",
      data: { reason: "SPACE_SELECTION_REQUIRED" },
    });
    expect(requests.filter((item) => new URL(item.url).pathname !== "/api/v1/auth")).toHaveLength(
      0,
    );
  });

  it("ignores a browser Space header and injects the validated server selection", async () => {
    const { gateway, requests } = connectedGateway(
      [
        { id: "spc_1", name: "Acme" },
        { id: "spc_2", name: "Globex" },
      ],
      { selectedSpace: { id: "spc_1", name: "Acme" } },
    );
    const response = await gateway.proxy(
      request("/api/v1/bases", { headers: { "x-busabase-space": "spc_2" } }),
    );
    expect(response.status).toBe(200);
    const proxied = requests.find((item) => new URL(item.url).pathname === "/api/v1/bases");
    expect(proxied?.headers.get("x-busabase-space")).toBe("spc_1");
    expect(proxied?.headers.get("authorization")).toBe("Bearer bso_access");
  });

  it("returns a typed retryable error when the upstream API is unavailable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("upstream unavailable");
    });
    storeBusabaseAirAppOAuthCredential(
      {
        appId: APP_ID,
        baseUrl: "https://busabase.example.com",
        tokenSet: tokenSet(),
        selectedSpace: { id: "spc_1", name: "Acme" },
      },
      { rootDir },
    );
    const gateway = createBusabaseAirAppLocalGateway({
      appId: APP_ID,
      credentialStore: { rootDir },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const response = await gateway.proxy(request("/api/v1/bases"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      data: { reason: "AUTH_UNAVAILABLE" },
    });
  });

  it("removes the local registration on logout", async () => {
    const { gateway } = connectedGateway([{ id: "spc_1", name: "Acme" }]);
    const response = await gateway.logout(
      request("/auth/logout", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:3111" },
      }),
    );
    expect(response.status).toBe(200);
    expect(loadBusabaseAirAppOAuthCredential(APP_ID, { rootDir })).toBeNull();
  });
});

describe("describeBusabaseAirAppRuntime", () => {
  it("reports standalone when nothing injected the variable", () => {
    expect(describeBusabaseAirAppRuntime({})).toEqual({
      runtime: "standalone",
      knownRuntime: null,
      hosted: false,
      devProxy: false,
    });
  });

  it("reports a known engine both verbatim and narrowed", () => {
    expect(describeBusabaseAirAppRuntime({ BUSABASE_AIRAPP_RUNTIME: "nodepod" })).toMatchObject({
      runtime: "nodepod",
      knownRuntime: "nodepod",
      hosted: true,
    });
  });

  /**
   * The whole reason `hosted` is presence and not membership. An engine this SDK
   * predates still means Busabase spawned the process — only Busabase sets the
   * variable at all. A list-based check answered "standalone" here, and that is
   * what broke 66 shipped apps when `local-node` became `local`.
   */
  it("treats an engine it has never heard of as hosted, with knownRuntime null", () => {
    expect(
      describeBusabaseAirAppRuntime({ BUSABASE_AIRAPP_RUNTIME: "an-engine-from-2027" }),
    ).toMatchObject({ runtime: "an-engine-from-2027", knownRuntime: null, hosted: true });
  });

  it("gets the renamed and newer engines right, which the old list did not", () => {
    expect(describeBusabaseAirAppRuntime({ BUSABASE_AIRAPP_RUNTIME: "local" }).hosted).toBe(true);
    expect(describeBusabaseAirAppRuntime({ BUSABASE_AIRAPP_RUNTIME: "sandock" }).hosted).toBe(true);
  });

  it("keeps devProxy as a separate axis from hosting", () => {
    const report = describeBusabaseAirAppRuntime({ BUSABASE_BASE_URL: "http://localhost:15419" });
    expect(report.hosted).toBe(false);
    expect(report.devProxy).toBe(true);
  });
});
