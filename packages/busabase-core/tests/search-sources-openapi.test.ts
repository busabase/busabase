import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `search`'s new `sources` scope parameter, driven through the PUBLIC
 * OpenAPI REST surface (`GET /api/v1/search`) — the layer
 * `search-sources-scope.test.ts`'s in-process `createRouterClient` skips.
 * `sources` is a repeated `?sources=records&sources=files`-style query
 * param on a GET route; this proves that actually round-trips into an
 * array server-side, not just the in-process object-input path.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const API = "http://localhost/api/v1";
const RECORD_MARKER = "HTTPSOURCEMARKER4d6f";

describe("search — sources scope over real HTTP (repeated query-param array)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let handler: OpenAPIHandler<Record<never, never>>;

  const get = async (routePath: string): Promise<{ status: number; body: any }> => {
    const request = new Request(`${API}${routePath}`, { method: "GET" });
    const result = await handler.handle(request, { context: {} });
    if (!result.matched) throw new Error(`no OpenAPI route matched GET ${routePath}`);
    return { status: result.response.status, body: await result.response.json() };
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-sources-http-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-sources-http-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    handler = new OpenAPIHandler(busabaseRouter);

    const client: Client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "http-sources-base",
      name: "HTTP Sources Base",
      fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
      autoMerge: true,
    });
    if (!("id" in base)) throw new Error("Expected a materialized BaseVO");
    const cr = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { notes: `Contains ${RECORD_MARKER} for the HTTP test.` },
      submittedBy: "test",
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("a single ?sources= query param round-trips into a scoped search", async () => {
    const res = await get(`/search?query=${RECORD_MARKER}&sources=records`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { kind: string }) => r.kind === "record")).toBe(true);
  });

  it("?sources= scoped away from records finds nothing for a records-only marker", async () => {
    const res = await get(`/search?query=${RECORD_MARKER}&sources=files`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBe(0);
  });

  it("a REPEATED ?sources=records&sources=files query param round-trips into an array", async () => {
    const res = await get(`/search?query=${RECORD_MARKER}&sources=records&sources=files`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { kind: string }) => r.kind === "record")).toBe(true);
  });

  it("omitting ?sources= over real HTTP still searches everything (unchanged default)", async () => {
    const res = await get(`/search?query=${RECORD_MARKER}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { kind: string }) => r.kind === "record")).toBe(true);
  });

  // The real oRPC client (used by both `busabase-cli` and the SDK) serializes
  // an array input as bracket-indexed params (`sources[0]=records`), not
  // repeated keys — confirmed by inspecting the actual URL the CLI's fetch
  // call produces. Prove the server parses that shape too, not just the
  // repeated-key shape a human would type by hand with curl.
  it("bracket-indexed ?sources[0]=...&sources[1]=... (the real client's array shape) round-trips", async () => {
    const res = await get(`/search?query=${RECORD_MARKER}&sources%5B0%5D=records`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { kind: string }) => r.kind === "record")).toBe(true);
  });
});
