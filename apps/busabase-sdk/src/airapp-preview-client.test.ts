import { describe, expect, it } from "vitest";
import { createBusabaseClient } from "./client.js";

describe("agent AirApp preview transport", () => {
  it("starts, polls, and stops through the public routes with the caller's auth and space", async () => {
    const requests: Request[] = [];
    const state = {
      status: "installing",
      engine: "remote",
      previewUrl: null,
      logs: [],
      error: null,
      exitCode: null,
    };
    const client = createBusabaseClient({
      baseUrl: "https://busabase.example.test",
      apiKey: "test-agent-key",
      spaceId: "test-space",
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        return Response.json(request.url.endsWith("/stop") ? { stopped: true } : state);
      },
    });

    await expect(client.airapps.previewStart({ nodeId: "app", engine: "remote" })).resolves.toEqual(
      state,
    );
    await expect(client.airapps.previewState({ nodeId: "app" })).resolves.toEqual(state);
    await expect(client.airapps.previewStop({ nodeId: "app" })).resolves.toEqual({ stopped: true });

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/api/v1/airapps/app/preview/start"],
      ["GET", "/api/v1/airapps/app/preview"],
      ["POST", "/api/v1/airapps/app/preview/stop"],
    ]);
    expect(await requests[0]?.json()).toEqual({ engine: "remote" });
    expect(new URL(requests[1]!.url).search).toBe("");
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe("Bearer test-agent-key");
      expect(request.headers.get("x-busabase-space")).toBe("test-space");
    }
  });
});
