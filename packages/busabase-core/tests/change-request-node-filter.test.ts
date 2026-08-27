import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROOT_NODE_ID } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const NOISE_CHANGE_REQUESTS = 105;

describe("changeRequests affectsNodeId filter", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let targetNodeId = "";
  let directAirAppNodeId = "";
  let targetRecordCrId = "";
  let targetNodeOperationCrId = "";
  let directAirAppCrId = "";
  let pendingCreateParentNodeId = "";
  let pendingCreateCrId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cr-node-filter-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-cr-node-filter-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const fields = [{ slug: "name", name: "Name", type: "text" as const, required: true }];
    const target = await client.bases.create({
      slug: "cr-node-filter-target",
      name: "CR Node Filter Target",
      fields,
      autoMerge: true,
    });
    const noise = await client.bases.create({
      slug: "cr-node-filter-noise",
      name: "CR Node Filter Noise",
      fields,
      autoMerge: true,
    });
    targetNodeId = target.nodeId;

    const targetRecordCr = await client.bases.createChangeRequest({
      baseId: target.id,
      fields: { name: "Target record" },
      submittedBy: "filter-test",
      autoMerge: false,
    });
    targetRecordCrId = targetRecordCr.id;
    const targetNodeOperationCr = await client.nodes.createChangeRequest({
      message: "Rename target node",
      submittedBy: "filter-test",
      autoMerge: false,
      operations: [{ kind: "rename", nodeId: target.nodeId, name: "Renamed target" }],
    });
    targetNodeOperationCrId = targetNodeOperationCr.id;

    const airapp = await client.fileTrees.create({
      type: "airapp",
      slug: "cr-node-filter-airapp",
      name: "CR Node Filter AirApp",
      autoMerge: true,
    });
    directAirAppNodeId = airapp.node.id;
    const current = await client.fileTrees.readFile({
      type: "airapp",
      nodeId: airapp.node.id,
      filePath: "client.js",
    });
    const directAirAppCr = await client.fileTrees.createChangeRequest({
      type: "airapp",
      nodeId: airapp.node.id,
      message: "Update AirApp client",
      submittedBy: "filter-test",
      autoMerge: false,
      operations: [
        {
          kind: "update",
          path: "client.js",
          content: `${current.content}\nconsole.log("node filter");\n`,
          baseContentHash: current.contentHash,
        },
      ],
    });
    directAirAppCrId = directAirAppCr.id;

    // A pending node create: neither the CR row nor the operation carries a
    // nodeId (the node does not exist until the merge), so the only link to the
    // parent is `commit.payload.parentNodeId`.
    pendingCreateParentNodeId =
      (await client.nodes.get({ nodeId: airapp.node.id })).parentId || ROOT_NODE_ID;
    const pendingCreate = await client.fileTrees.create({
      type: "airapp",
      slug: "cr-node-filter-pending-create",
      name: "CR Node Filter Pending Create",
      autoMerge: false,
    });
    pendingCreateCrId = (pendingCreate as unknown as { id: string }).id;

    // A record commit's payload IS the caller's field map, so a Base may legally
    // own a field slugged `parentNodeId` holding some other node's id. That must
    // not drag its record CR into that node's scope.
    const decoy = await client.bases.create({
      slug: "cr-node-filter-decoy",
      name: "CR Node Filter Decoy",
      fields: [{ slug: "parentNodeId", name: "Parent Node Id", type: "text" as const }],
      autoMerge: true,
    });
    await client.bases.createChangeRequest({
      baseId: decoy.id,
      fields: { parentNodeId: targetNodeId },
      submittedBy: "filter-test",
      autoMerge: false,
    });

    for (let index = 0; index < NOISE_CHANGE_REQUESTS; index++) {
      await client.bases.createChangeRequest({
        baseId: noise.id,
        fields: { name: `Noise ${index}` },
        submittedBy: "filter-test",
        autoMerge: false,
      });
    }
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds Base-backed and operation-scoped CRs beyond the first 100 global rows", async () => {
    const page = await client.changeRequests.list({
      affectsNodeId: targetNodeId,
      status: ["in_review"],
      limit: 100,
    });
    expect(page.changeRequests.map((changeRequest) => changeRequest.id).sort()).toEqual(
      [targetRecordCrId, targetNodeOperationCrId].sort(),
    );
    expect(page.nextCursor).toBeNull();
  });

  it("keeps cursor and numbered pagination aligned inside the node scope", async () => {
    const cursorIds: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 3; guard++) {
      const page = await client.changeRequests.list({
        affectsNodeId: targetNodeId,
        status: ["in_review"],
        limit: 1,
        cursor,
      });
      cursorIds.push(...page.changeRequests.map((changeRequest) => changeRequest.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const numbered = await client.changeRequests.listPage({
      affectsNodeId: targetNodeId,
      status: ["in_review"],
      page: 1,
      pageSize: 100,
    });
    expect(numbered.total).toBe(2);
    expect(numbered.changeRequests.map((changeRequest) => changeRequest.id)).toEqual(cursorIds);
  });

  // The inbox snapshot returns whole-space tab badges next to the page, so it
  // deliberately has no `affectsNodeId`: the contract strips one, and the number
  // under the list keeps matching the number on the tab.
  it("keeps the inbox snapshot page and badges in agreement, node scope or not", async () => {
    const scoped = await client.changeRequests.inboxSnapshot({
      affectsNodeId: targetNodeId,
      status: ["in_review"],
      page: 1,
      pageSize: 100,
      // Cast because the param is deliberately absent from this contract.
    } as unknown as Parameters<typeof client.changeRequests.inboxSnapshot>[0]);
    const plain = await client.changeRequests.inboxSnapshot({
      status: ["in_review"],
      page: 1,
      pageSize: 100,
    });

    expect(scoped.total).toBe(scoped.counts.review);
    expect(scoped.total).toBe(plain.total);
    expect(plain.total).toBe(plain.counts.review);
  });

  it("matches a pending node create through its parent, and only for node creates", async () => {
    const byParent = await client.changeRequests.list({
      affectsNodeId: pendingCreateParentNodeId,
      status: ["in_review"],
      limit: 100,
    });
    expect(byParent.changeRequests.map((changeRequest) => changeRequest.id)).toEqual([
      pendingCreateCrId,
    ]);

    // The decoy record CR carries `parentNodeId: targetNodeId` in its commit
    // payload but is not a node create, so the node scope must exclude it.
    const byTarget = await client.changeRequests.list({
      affectsNodeId: targetNodeId,
      status: ["in_review"],
      limit: 100,
    });
    expect(byTarget.changeRequests.map((changeRequest) => changeRequest.id).sort()).toEqual(
      [targetRecordCrId, targetNodeOperationCrId].sort(),
    );
  });

  it("matches a direct file-tree target and excludes unrelated nodes", async () => {
    const direct = await client.changeRequests.list({
      affectsNodeId: directAirAppNodeId,
      status: ["in_review"],
      limit: 10,
    });
    expect(direct.changeRequests.map((changeRequest) => changeRequest.id)).toEqual([
      directAirAppCrId,
    ]);

    const missing = await client.changeRequests.list({
      affectsNodeId: "nod_missing",
      status: ["in_review"],
      limit: 10,
    });
    expect(missing.changeRequests).toEqual([]);
    expect(missing.nextCursor).toBeNull();
  });
});
