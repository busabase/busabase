import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudSpacesClient, createCloudSpacesRpcOptions } from "./cloud-spaces";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("createCloudSpacesRpcOptions", () => {
  it("targets the OAuth-enabled Cloud RPC endpoint and preserves authorization headers", async () => {
    const headers = vi.fn(async () => ({
      authorization: "Bearer bso_mobile",
      "x-busabase-client": "native",
    }));

    const options = createCloudSpacesRpcOptions("https://busabase.com///", headers);

    expect(options.url).toBe("https://busabase.com/api/rpc");
    await expect(options.headers()).resolves.toEqual({
      authorization: "Bearer bso_mobile",
      "x-busabase-client": "native",
    });
  });

  it("sends spaces.list through the RPC transport with the mobile OAuth token", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as typeof fetch;
    const client = createCloudSpacesClient("https://busabase.com", async () => ({
      authorization: "Bearer bso_mobile",
      "x-busabase-client": "native",
    }));

    await client.spaces.list().catch(() => undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    const request = input instanceof Request ? input : new Request(input, init);
    expect(new URL(request.url).pathname).toBe("/api/rpc/spaces/list");
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer bso_mobile");
    expect(request.headers.get("x-busabase-client")).toBe("native");
  });
});
