import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Permanently deleting a Trash item is UI-only: `nodes.purge` has no REST
 * route, and the OSS `/api/v1` router drops it so the path oRPC would infer is
 * not served either. Archive — the reversible removal — stays on `/api/v1`.
 */
describe("node purge is UI-only over the real OSS OpenAPI boundary", () => {
  let dataDir = "";
  let storageDir = "";
  let route: typeof import("../src/app/api/v1/[[...rest]]/route");

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-purge-ui-only-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-purge-ui-only-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    route = await import("../src/app/api/v1/[[...rest]]/route");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const nodeChangeRequest = async (operation: Record<string, unknown>) => {
    const response = await route.POST(
      new Request("http://localhost/api/v1/nodes/change-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          autoMerge: true,
          submittedBy: "purge-test",
          operations: [operation],
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };

  it("archives over /api/v1 but refuses to purge the archived node", async () => {
    const created = await nodeChangeRequest({
      kind: "create",
      nodeType: "folder",
      name: "Purge target",
      slug: "purge-target",
    });
    const nodeId = created.mergeSummary?.mergedNodeIds?.[0] as string;
    expect(nodeId).toBeTruthy();

    await nodeChangeRequest({ kind: "delete", nodeId });

    // The old route.
    const oldRoute = await route.DELETE(
      new Request(`http://localhost/api/v1/nodes/${nodeId}`, { method: "DELETE" }),
    );
    expect(oldRoute.status).toBe(404);

    // The path oRPC infers for a route-less procedure. Non-vacuous: without
    // `withoutNodePurge` in the route, this request reaches `purgeNode` and
    // permanently deletes the node.
    const inferred = await route.POST(
      new Request("http://localhost/nodes/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId }),
      }),
    );
    expect(inferred.status).toBe(404);
    expect(await inferred.json()).toMatchObject({ error: "Not found" });

    // Still in Trash, still restorable.
    const archived = await route.GET(
      new Request(`http://localhost/api/v1/nodes/route-state/${nodeId}`, { method: "GET" }),
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ status: "archived", canRestore: true });
  });

  it("leaves purge out of the published spec", async () => {
    const response = await route.GET(
      new Request("http://localhost/api/v1/openapi.json", { method: "GET" }),
    );
    const spec = await response.json();
    expect(spec.paths["/api/v1/nodes/{nodeId}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/nodes/{nodeId}"]?.delete).toBeUndefined();
  });

  it("still lets the dashboard purge over /api/rpc", async () => {
    const { createORPCClient } = await import("@orpc/client");
    const { RPCLink } = await import("@orpc/client/fetch");
    const rpcRoute = await import("../src/app/api/rpc/[[...rest]]/route");
    const client = createORPCClient<{
      nodes: { purge: (input: { nodeId: string }) => Promise<{ purged: boolean }> };
    }>(
      new RPCLink({ url: "http://localhost/api/rpc", fetch: (request) => rpcRoute.POST(request) }),
    );

    const created = await nodeChangeRequest({
      kind: "create",
      nodeType: "folder",
      name: "Purge from UI",
      slug: "purge-from-ui",
    });
    const nodeId = created.mergeSummary?.mergedNodeIds?.[0] as string;
    await nodeChangeRequest({ kind: "delete", nodeId });

    await expect(client.nodes.purge({ nodeId })).resolves.toEqual({ purged: true });
  });
});
