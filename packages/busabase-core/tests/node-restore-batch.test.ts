import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * #B — node restore is scoped to the deleted node's own subtree, not the space-wide
 * archive timestamp. A single change request can delete several unrelated nodes, and
 * every operation in a CR shares one merge timestamp; restoring one must NOT resurrect
 * the others.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("node restore subtree scope (#B)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-restorebatch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-restorebatch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = (changeRequestId: string) =>
    client.changeRequests
      .review({ changeRequestId, verdict: "approved" })
      .then(() => client.changeRequests.merge({ changeRequestId }));

  const folderBySlug = async (slug: string) =>
    (await client.folders.list()).find((f) => f.node.slug === slug);

  it("restoring one node from a multi-delete CR leaves the others deleted", async () => {
    // Two unrelated folders.
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "batch-f", name: "F" }],
        })
      ).id,
    );
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "batch-g", name: "G" }],
        })
      ).id,
    );
    const fId = (await folderBySlug("batch-f"))!.node.id;
    const gId = (await folderBySlug("batch-g"))!.node.id;

    // Delete BOTH in a single change request → both archived at the same merge timestamp.
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [
            { kind: "delete", nodeId: fId },
            { kind: "delete", nodeId: gId },
          ],
        })
      ).id,
    );
    expect(await folderBySlug("batch-f")).toBeUndefined();
    expect(await folderBySlug("batch-g")).toBeUndefined();

    // Restore only F.
    await approveAndMerge(
      (await client.nodes.createChangeRequest({ operations: [{ kind: "restore", nodeId: fId }] }))
        .id,
    );

    // F is back; G stays deleted (NOT resurrected by the shared timestamp).
    expect(await folderBySlug("batch-f")).toBeDefined();
    expect(await folderBySlug("batch-g")).toBeUndefined();
  });

  it("restoring a folder still brings back its whole subtree", async () => {
    // Parent folder with a child folder.
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "batch-parent", name: "P" }],
        })
      ).id,
    );
    const pId = (await folderBySlug("batch-parent"))!.node.id;
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [
            {
              kind: "create",
              nodeType: "folder",
              slug: "batch-child",
              name: "Child",
              parentNodeId: pId,
            },
          ],
        })
      ).id,
    );
    expect(await folderBySlug("batch-child")).toBeDefined();

    // Delete the parent (cascades to the child), then restore it.
    await approveAndMerge(
      (await client.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId: pId }] }))
        .id,
    );
    expect(await folderBySlug("batch-parent")).toBeUndefined();
    expect(await folderBySlug("batch-child")).toBeUndefined();

    await approveAndMerge(
      (await client.nodes.createChangeRequest({ operations: [{ kind: "restore", nodeId: pId }] }))
        .id,
    );

    // Both the parent and its child come back.
    expect(await folderBySlug("batch-parent")).toBeDefined();
    expect(await folderBySlug("batch-child")).toBeDefined();
  });
});
