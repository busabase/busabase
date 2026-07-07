import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient, ORPCError } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type DrivesClient = ReturnType<
  typeof createRouterClient<typeof busabaseRouter, Record<never, never>>
>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const API = "http://busabase.test/api/v1";
const imageBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const imageBase64 = imageBytes.toString("base64");
const imageHash = `sha256:${createHash("sha256").update(imageBytes).digest("hex")}`;

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

  it("uploads and reads arbitrary files through the Drive RPC change-request flow", async () => {
    const drive = await client.drives.create({ slug: "binary-drive", name: "Binary Drive" });
    const createCr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      message: "Add product image",
      operations: [
        {
          kind: "create",
          path: "media/logo.png",
          contentBase64: imageBase64,
          mimeType: "image/png",
        },
      ],
    });

    expect(createCr.primaryOperation?.operation).toBe("drive_file_create");
    await approveAndMerge(createCr.id);

    const file = await client.drives.readFile({
      nodeId: drive.node.id,
      filePath: "media/logo.png",
    });
    expect(file).toMatchObject({
      encoding: "base64",
      content: "",
      contentBase64: imageBase64,
      mimeType: "image/png",
      contentHash: imageHash,
    });
    expect(Buffer.from(file.contentBase64, "base64")).toEqual(imageBytes);
  });

  it("uploads and reads arbitrary files through the public Drive OpenAPI route", async () => {
    const handler = new OpenAPIHandler(busabaseRouter);
    const call = async (method: string, routePath: string, body?: unknown) => {
      const request = new Request(`${API}${routePath}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await handler.handle(request, { context: {} });
      if (!result.matched) {
        throw new Error(`no OpenAPI route matched ${method} ${routePath}`);
      }
      return { status: result.response.status, body: await result.response.json() };
    };
    const ok = async (method: string, routePath: string, body?: unknown) => {
      const result = await call(method, routePath, body);
      if (result.status >= 400) {
        throw new Error(
          `${method} ${routePath} -> ${result.status}: ${JSON.stringify(result.body)}`,
        );
      }
      return result.body;
    };

    const drive = await ok("POST", "/drives", {
      slug: "openapi-binary-drive",
      name: "OpenAPI Binary Drive",
    });
    const changeRequest = await ok("POST", `/drives/${drive.node.id}/change-requests`, {
      message: "Add REST archive",
      operations: [
        {
          kind: "create",
          path: "rest/export.bin",
          contentBase64: imageBase64,
          mimeType: "application/octet-stream",
        },
      ],
    });
    await ok("POST", `/change-requests/${changeRequest.id}/reviews`, { verdict: "approved" });
    await ok("POST", `/change-requests/${changeRequest.id}/merge`);

    const file = await ok("GET", `/drives/${drive.node.id}/files/rest/export.bin`);
    expect(file.encoding).toBe("base64");
    expect(file.contentBase64).toBe(imageBase64);
    expect(file.contentHash).toBe(imageHash);
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
