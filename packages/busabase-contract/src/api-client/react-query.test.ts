import { describe, expect, it } from "vitest";
import { createBusabaseORPCClient } from "./react-query";

describe("createBusabaseORPCClient batching", () => {
  it("keeps the AirApp runtime event stream out of concurrent RPC batches", async () => {
    const requests: Array<{ body: string; path: string }> = [];
    const client = createBusabaseORPCClient("http://localhost/api/rpc", {
      fetch: async (request) => {
        requests.push({
          body: await request.clone().text(),
          path: new URL(request.url).pathname,
        });
        return new Response("", { status: 500 });
      },
    });

    await Promise.allSettled([
      client.airapps.runLocal({
        engine: "remote",
        files: {},
        nodeId: "nod_airapp_batch_regression",
      }),
      client.nodes.list({}),
      client.bases.list({}),
    ]);

    expect(requests).toHaveLength(2);

    const streamRequest = requests.find((request) => request.path.includes("airapps/runLocal"));
    expect(streamRequest?.path).toBe("/api/rpc/airapps/runLocal");

    const batchRequest = requests.find((request) => request.path.endsWith("/__batch__"));
    expect(batchRequest).toBeDefined();
    expect(batchRequest?.body).not.toContain("airapps/runLocal");
  });
});
