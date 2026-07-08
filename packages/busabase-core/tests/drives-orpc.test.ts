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

  const createAsset = async (input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }) => {
    const request = await client.assets.createUploadUrl(input);
    const confirmed = await client.assets.confirm({
      storageKey: request.storageKey,
      ...input,
    });
    return {
      ...(await client.assets.get({ assetId: confirmed.assetId as string })).asset,
      assetId: confirmed.assetId as string,
    };
  };

  it("creates a Drive and merges file updates with hash protection", async () => {
    const drive = await client.drives.create({
      slug: "team-drive",
      name: "Team Drive",
      files: [{ path: "notes/today.md", content: "today\n" }],
    });
    expect(drive.node.type).toBe("drive");
    expect(drive.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["README.md", "notes/today.md"]),
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

  it("uploads and reads arbitrary Drive files as asset refs through the RPC change-request flow", async () => {
    const asset = await createAsset({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: 512,
      contentHash: `sha256:${"a".repeat(64)}`,
    });
    const drive = await client.drives.create({
      slug: "asset-file-drive",
      name: "Asset File Drive",
    });
    const createCr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      message: "Add product image",
      operations: [
        {
          kind: "create",
          path: "media/logo.png",
          assetId: asset.assetId,
          displayName: "Product Logo",
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
      encoding: "url",
      content: "",
      mimeType: "image/png",
      assetId: asset.assetId,
      displayName: "Product Logo",
    });
  });

  it("uploads and reads arbitrary Drive files as asset refs through the public OpenAPI route", async () => {
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

    const asset = await createAsset({
      fileName: "export.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 256,
      contentHash: `sha256:${"b".repeat(64)}`,
    });
    const drive = await ok("POST", "/drives", {
      slug: "openapi-asset-file-drive",
      name: "OpenAPI Asset File Drive",
    });
    const legacyUpload = await call("POST", `/drives/${drive.node.id}/change-requests`, {
      message: "Legacy direct binary upload",
      operations: [
        {
          kind: "create",
          path: "rest/legacy.bin",
          contentBase64: "AA==",
          mimeType: "application/octet-stream",
        },
      ],
    });
    expect(legacyUpload.status).toBeGreaterThanOrEqual(400);

    const changeRequest = await ok("POST", `/drives/${drive.node.id}/change-requests`, {
      message: "Add REST archive",
      operations: [
        {
          kind: "create",
          path: "rest/export.bin",
          assetId: asset.assetId,
          displayName: "REST Export",
          mimeType: "application/octet-stream",
        },
      ],
    });
    await ok("POST", `/change-requests/${changeRequest.id}/reviews`, { verdict: "approved" });
    await ok("POST", `/change-requests/${changeRequest.id}/merge`);

    const file = await ok("GET", `/drives/${drive.node.id}/files/rest/export.bin`);
    expect(file.encoding).toBe("url");
    expect(file.assetId).toBe(asset.assetId);
    expect(file.displayName).toBe("REST Export");
  });

  it("stores Drive files as Assets with searchable AI-readable metadata", async () => {
    const asset = await createAsset({
      fileName: "wealth-guide.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      contentHash: `sha256:${"c".repeat(64)}`,
    });
    const drive = await client.drives.create({
      slug: "asset-backed-drive",
      name: "Asset Backed Drive",
    });
    const createCr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      message: "Add customer PDF",
      operations: [
        {
          kind: "create",
          path: "materials/wealth-guide.pdf",
          assetId: asset.assetId,
          displayName: "Wealth Guide PDF",
          mimeType: "application/pdf",
        },
      ],
    });
    await approveAndMerge(createCr.id);
    await client.assets.updateMetadata({
      assetId: asset.assetId,
      metadata: {
        summary: "ACME Wealth Guide brochure",
        extractedText: "insurer: ACME\nproduct: Wealth Guide\nfileType: brochure\n",
        tags: ["brochure", "insurance"],
        schema: "asset-meta/v1",
      },
    });

    const files = await client.drives.listFiles({ nodeId: drive.node.id });
    expect(files.find((file) => file.path.startsWith(".busabase/"))).toBeUndefined();
    expect(files.find((file) => file.path === "materials/wealth-guide.pdf")).toMatchObject({
      mimeType: "application/pdf",
      assetId: asset.assetId,
      displayName: "Wealth Guide PDF",
    });
    expect(files.find((file) => file.path.endsWith(".meta"))).toBeUndefined();

    const file = await client.drives.readFile({
      nodeId: drive.node.id,
      filePath: "materials/wealth-guide.pdf",
    });
    expect(file).toMatchObject({
      encoding: "url",
      content: "",
      mimeType: "application/pdf",
      assetId: asset.assetId,
      displayName: "Wealth Guide PDF",
      assetUrl: asset.url,
    });

    const assetDetail = await client.assets.get({ assetId: asset.assetId });
    expect(assetDetail.asset.metadata).toMatchObject({
      summary: "ACME Wealth Guide brochure",
      schema: "asset-meta/v1",
    });
    expect(assetDetail.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeSlug: "asset-backed-drive",
          nodeType: "drive",
          ownerType: "drive",
          path: "materials/wealth-guide.pdf",
        }),
      ]),
    );

    const byDisplayName = await client.search({ query: "Wealth Guide", limit: 10 });
    expect(byDisplayName.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          title: "Wealth Guide PDF",
          href: "/drive/asset-backed-drive",
        }),
      ]),
    );

    const byMetaBody = await client.search({ query: "brochure", limit: 10 });
    expect(byMetaBody.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          title: "Wealth Guide PDF",
          href: "/drive/asset-backed-drive",
        }),
      ]),
    );
  });

  it("creates a Drive with an initial Asset-backed file", async () => {
    const asset = await createAsset({
      fileName: "initial-deck.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      contentHash: `sha256:${"d".repeat(64)}`,
    });
    const drive = await client.drives.create({
      slug: "initial-asset-backed-drive",
      name: "Initial Asset Backed Drive",
      files: [
        {
          path: "deck.pdf",
          assetId: asset.assetId,
          displayName: "Initial Deck",
        },
      ],
    });

    expect(drive.files.find((file) => file.path === "deck.pdf")).toMatchObject({
      assetId: asset.assetId,
      displayName: "Initial Deck",
      mimeType: "application/pdf",
    });
    const assetDetail = await client.assets.get({ assetId: asset.assetId });
    expect(assetDetail.usages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeSlug: "initial-asset-backed-drive",
          ownerType: "drive",
          path: "deck.pdf",
        }),
      ]),
    );
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
