import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient, ORPCError } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type DrivesClient = ReturnType<
  typeof createRouterClient<typeof busabaseRouter, Record<never, never>>
>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Drive API — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: DrivesClient;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drives-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-drives-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  it("creates a Drive and merges file updates with hash protection", async () => {
    const drive = await client.drives.create({
      slug: "team-drive",
      name: "Team Drive",
      files: [{ path: "notes/today.md", content: "today\n" }],
    });
    expect(drive.node.type).toBe("drive");
    expect(drive.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["README.md", "notes", "notes/today.md"]),
    );

    const current = await client.drives.readFile({
      nodeId: drive.node.id,
      filePath: "notes/today.md",
    });
    const updateCr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      operations: [
        {
          kind: "update",
          path: "notes/today.md",
          content: "today\nupdated\n",
          baseContentHash: current.contentHash,
        },
      ],
    });
    expect(updateCr.primaryOperation?.operation).toBe("drive_file_update");
    await approveAndMerge(updateCr.id);
    await expect(
      client.drives.readFile({ nodeId: drive.node.id, filePath: "notes/today.md" }),
    ).resolves.toMatchObject({ content: "today\nupdated\n" });
  });

  it("returns CONFLICT for stale Drive file merges", async () => {
    const drive = await client.drives.create({ slug: "stale-drive", name: "Stale Drive" });
    const staleCr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      operations: [
        {
          kind: "update",
          path: "README.md",
          content: "stale\n",
          baseContentHash:
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
    });
    await client.changeRequests.review({ changeRequestId: staleCr.id, verdict: "approved" });

    await expect(
      client.changeRequests.merge({ changeRequestId: staleCr.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("returns BAD_REQUEST for invalid Drive file paths", async () => {
    const drive = await client.drives.create({ slug: "path-drive", name: "Path Drive" });

    await expect(
      client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [{ kind: "create", path: "../escape.md", content: "nope\n" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("still exposes ORPCError instances to local callers", async () => {
    const drive = await client.drives.create({ slug: "error-drive", name: "Error Drive" });

    await expect(
      client.drives.createChangeRequest({
        nodeId: drive.node.id,
        operations: [{ kind: "create", path: "bad/../escape.md", content: "nope\n" }],
      }),
    ).rejects.toBeInstanceOf(ORPCError);
  });
});
