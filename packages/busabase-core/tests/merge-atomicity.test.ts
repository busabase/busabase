import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * #3 — a change-request merge is atomic. A multi-operation node CR that fails on a
 * later operation must roll back the operations already applied, instead of leaving
 * the CR half-merged (some ops "merged", the CR stuck "approved"). The whole merge
 * runs in one DB transaction; every db touch goes through the tx so re-acquiring the
 * getDb() singleton can't deadlock pglite's single connection.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("merge atomicity", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-atomicity-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-atomicity-storage-"));
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

  it("rolls back an earlier op when a later op in the same node CR fails", async () => {
    // Two active folders.
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "atom-a", name: "A" }],
        })
      ).id,
    );
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "atom-b", name: "B" }],
        })
      ).id,
    );
    const aId = (await folderBySlug("atom-a"))!.node.id;
    const bId = (await folderBySlug("atom-b"))!.node.id;

    // One CR: rename A (valid) THEN restore B (invalid — B is not archived → throws).
    const cr = await client.nodes.createChangeRequest({
      operations: [
        { kind: "rename", nodeId: aId, name: "A Renamed" },
        { kind: "restore", nodeId: bId },
      ],
    });
    await expect(approveAndMerge(cr.id)).rejects.toThrow();

    // The rename must have rolled back — A keeps its original name.
    expect((await folderBySlug("atom-a"))!.node.name).toBe("A");
  });

  it("commits every op when a multi-op node CR fully succeeds", async () => {
    await approveAndMerge(
      (
        await client.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "atom-c", name: "C" }],
        })
      ).id,
    );
    const cId = (await folderBySlug("atom-c"))!.node.id;

    // Two valid ops in one CR: rename C, then create a child folder under it.
    const cr = await client.nodes.createChangeRequest({
      operations: [
        { kind: "rename", nodeId: cId, name: "C Renamed" },
        {
          kind: "create",
          nodeType: "folder",
          slug: "atom-c-child",
          name: "Child",
          parentNodeId: cId,
        },
      ],
    });
    await approveAndMerge(cr.id);

    expect((await folderBySlug("atom-c"))!.node.name).toBe("C Renamed");
    expect(await folderBySlug("atom-c-child")).toBeDefined();
  });
});
