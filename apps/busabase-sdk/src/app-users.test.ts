import { describe, expect, it } from "vitest";
import { APP_USER_SESSION_HEADER } from "./app-users.js";
import { Busabase } from "./index.js";

interface Captured {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
}

const clientWith = (response: unknown) => {
  const calls: Captured[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const bb = new Busabase({
    baseUrl: "https://example.test",
    apiKey: "bbk_test",
    spaceId: "spc_1",
    fetch: fetchMock as typeof fetch,
  });
  return { bb, calls };
};

describe("appUsers client", () => {
  it("queryRecords sends ownerField in the body and the session in its header", async () => {
    const { bb, calls } = clientWith({ records: [], nextCursor: null });
    await bb.appUsers.queryRecords({
      appId: "app_1",
      sessionToken: "tok_1",
      baseId: "orders",
      ownerField: "customer-account",
      limit: 10,
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe("https://example.test/api/v1/app-users/records/query");
    expect(call?.headers.get(APP_USER_SESSION_HEADER)).toBe("tok_1");
    expect(call?.body).toEqual({
      appId: "app_1",
      baseId: "orders",
      ownerField: "customer-account",
      limit: 10,
    });
  });

  it("putSettings sends only enabled and appName", async () => {
    const { bb, calls } = clientWith({ appId: "app_1", enabled: true, appName: "Shop" });
    const settings = await bb.appUsers.putSettings({
      appId: "app_1",
      enabled: true,
      appName: "Shop",
    });
    expect(settings).toEqual({ appId: "app_1", enabled: true, appName: "Shop" });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://example.test/api/v1/app-users/apps/app_1/settings");
    expect(calls[0]?.body).toEqual({ enabled: true, appName: "Shop" });
  });
});
