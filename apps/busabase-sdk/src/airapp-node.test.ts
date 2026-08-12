import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBusabaseAirAppLocalGateway } from "./airapp-node.js";
import {
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
