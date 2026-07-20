import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SPACE_A = "space_node_metadata_a";
const SPACE_B = "space_node_metadata_b";

describe("nodes.updateMetadata", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let openApiHandler: OpenAPIHandler<Record<never, never>>;
  let baseId = "";
  let nodeId = "";

  const inSpace = <T>(
    spaceId: string,
    fn: () => Promise<T>,
    context: { actorId?: string; isSpaceManager?: boolean } = {},
  ): Promise<T> => runWithBusabaseContext({ spaceId, ...context }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-metadata-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-node-metadata-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    openApiHandler = new OpenAPIHandler(busabaseRouter);

    const base = await inSpace(
      SPACE_A,
      () => client.bases.create({ slug: "cms", name: "CMS", autoMerge: true }),
      { actorId: "alice", isSpaceManager: true },
    );
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    nodeId = base.nodeId;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("shallow-merges arbitrary keys, preserves existing metadata, and returns the Base id", async () => {
    await inSpace(
      SPACE_A,
      () =>
        client.nodes.updateMetadata({
          nodeId,
          metadata: {
            existing: "keep",
            nested: { preserved: true },
            replaced: "old",
          },
        }),
      { actorId: "alice", isSpaceManager: true },
    );

    const updated = await inSpace(
      SPACE_A,
      () =>
        client.nodes.updateMetadata({
          nodeId,
          metadata: {
            cms: { version: 1, bases: { posts: "bse_posts" } },
            nested: { replacement: true },
            replaced: "new",
          },
        }),
      { actorId: "alice", isSpaceManager: true },
    );

    expect(updated.baseId).toBe(baseId);
    expect(updated.metadata).toEqual({
      existing: "keep",
      nested: { replacement: true },
      replaced: "new",
      cms: { version: 1, bases: { posts: "bse_posts" } },
    });
    expect(updated.children).toEqual([]);
  });

  it("exposes the metadata merge through PATCH /api/v1/nodes/{nodeId}/metadata", async () => {
    const result = await inSpace(
      SPACE_A,
      () =>
        openApiHandler.handle(
          new Request(`http://localhost/api/v1/nodes/${nodeId}/metadata`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ metadata: { viaHttp: true } }),
          }),
          { context: {} },
        ),
      { actorId: "alice", isSpaceManager: true },
    );

    expect(result.matched).toBe(true);
    expect(result.response.status).toBe(200);
    const updated = (await result.response.json()) as {
      baseId: string | null;
      metadata: Record<string, unknown>;
    };
    expect(updated.baseId).toBe(baseId);
    expect(updated.metadata.viaHttp).toBe(true);
    expect(updated.metadata.existing).toBe("keep");
  });

  it("writes an audit event with key names but no metadata values", async () => {
    const secretValue = "must-not-appear-in-audit";
    await inSpace(
      SPACE_A,
      () => client.nodes.updateMetadata({ nodeId, metadata: { privateConfig: secretValue } }),
      { actorId: "alice", isSpaceManager: true },
    );

    const events = await inSpace(SPACE_A, () => client.auditEvents.list({ limit: 20 }), {
      actorId: "alice",
      isSpaceManager: true,
    });
    const event = events.find((candidate) => candidate.action === "node.metadata_updated");
    expect(event?.baseId).toBe(baseId);
    expect(event?.metadata).toEqual({ nodeId, updatedKeys: ["privateConfig"] });
    expect(JSON.stringify(event)).not.toContain(secretValue);
  });

  it("does not expose a node across spaces", async () => {
    await expect(
      inSpace(SPACE_B, () => client.nodes.updateMetadata({ nodeId, metadata: { cms: {} } }), {
        actorId: "alice",
        isSpaceManager: true,
      }),
    ).rejects.toThrow(/Node not found/);
  });

  it("requires write permission on a visible node", async () => {
    await expect(
      inSpace(SPACE_A, () => client.nodes.updateMetadata({ nodeId, metadata: { cms: {} } }), {
        actorId: "bob",
        isSpaceManager: false,
      }),
    ).rejects.toThrow(/Requires write access/);
  });

  it("rejects missing and archived nodes", async () => {
    await expect(
      inSpace(SPACE_A, () => client.nodes.updateMetadata({ nodeId: "nod_missing", metadata: {} }), {
        actorId: "alice",
        isSpaceManager: true,
      }),
    ).rejects.toThrow(/Node not found/);

    const changeRequest = await inSpace(
      SPACE_A,
      () =>
        client.nodes.createChangeRequest({
          autoMerge: true,
          operations: [{ kind: "create", nodeType: "folder", slug: "archived", name: "Archived" }],
        }),
      { actorId: "alice", isSpaceManager: true },
    );
    const archivedNodeId = changeRequest.mergeSummary?.mergedNodeIds?.[0];
    if (typeof archivedNodeId !== "string") throw new Error("Expected merged folder node id");
    await inSpace(
      SPACE_A,
      () =>
        client.nodes.createChangeRequest({
          autoMerge: true,
          operations: [{ kind: "delete", nodeId: archivedNodeId }],
        }),
      { actorId: "alice", isSpaceManager: true },
    );

    await expect(
      inSpace(
        SPACE_A,
        () => client.nodes.updateMetadata({ nodeId: archivedNodeId, metadata: { cms: {} } }),
        { actorId: "alice", isSpaceManager: true },
      ),
    ).rejects.toThrow(/Node not found/);
  });
});
