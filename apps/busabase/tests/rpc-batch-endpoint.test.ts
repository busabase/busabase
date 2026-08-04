import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The `/api/rpc/**\/__batch__` endpoint has to actually answer.
 *
 * The shared client (`busabase-contract`'s `api-client/react-query.ts`) collapses
 * a route's parallel queries into ONE batched POST. That only works if this app's
 * RPC route mounts `BatchHandlerPlugin` — and when it did not, the entire
 * self-hosted dashboard rendered "Invalid batch response" and loaded nothing.
 *
 * Nothing caught it: every other test drives the router through
 * `createRouterClient` IN PROCESS, which never touches HTTP and therefore never
 * touches the batch endpoint. This test closes that gap by going through the
 * real route handler.
 *
 * The batch request is not hand-written. It is captured from the real client by
 * stubbing `fetch`, so the wire format here can never drift from what the client
 * actually sends — a hand-rolled payload would keep passing after a client-side
 * format change and quietly stop guarding anything.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "..");

describe("/api/rpc batch endpoint", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** Ask the real shared client to make two parallel calls, and capture the single batched Request it emits. */
  const captureBatchRequest = async (): Promise<Request> => {
    // Relative import: this app does not declare `busabase-contract` as a direct
    // dependency (it reaches it through busabase-core), and the point is to use
    // the SAME client module the dashboard ships.
    const { createBusabaseORPCClient } = await import(
      "../../../packages/busabase-contract/src/api-client/react-query"
    );
    const captured: Request[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      captured.push(request.clone());
      // The client only needs SOMETHING back to settle; the assertions below run
      // against the real route handler, not this stub.
      return new Response("", { status: 500 });
    }) as typeof globalThis.fetch;
    try {
      const client = createBusabaseORPCClient("http://localhost/api/rpc");
      // Two calls in the same tick — exactly what a dashboard route does, and
      // what BatchLinkPlugin collapses into one request.
      await Promise.allSettled([
        (client as never as { nodes: { list: (i: unknown) => Promise<unknown> } }).nodes.list({}),
        (client as never as { bases: { list: (i: unknown) => Promise<unknown> } }).bases.list({}),
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
    const batched = captured.find((request) => request.url.includes("__batch__"));
    if (!batched) {
      throw new Error(
        `The shared client did not emit a batched request — it sent: ${captured
          .map((r) => r.url)
          .join(", ")}`,
      );
    }
    return batched;
  };

  it("the shared client really does batch parallel calls", async () => {
    const request = await captureBatchRequest();
    expect(request.url).toContain("__batch__");
  }, 120_000);

  it("answers the batched request the shared client sends", async () => {
    const captured = await captureBatchRequest();
    const { POST } = await import("../src/app/api/rpc/[[...rest]]/route");

    // Re-issue the captured request against the real route handler.
    const response = await POST(
      new Request(captured.url, {
        method: "POST",
        headers: captured.headers,
        body: await captured.text(),
      }),
    );

    // A route without BatchHandlerPlugin has no procedure at `…/__batch__`, so
    // it 404s and the dashboard shows "Invalid batch response".
    expect(response.status).not.toBe(404);
    expect(response.status).toBeLessThan(500);
  }, 120_000);
});
