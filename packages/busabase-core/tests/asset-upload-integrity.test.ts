import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { createDevUploadRoute, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("local attachment upload integrity", () => {
  let originalCwd: string;
  let dataDir: string;
  let storageDir: string;
  const client = createRouterClient(busabaseRouter);
  const handler = new OpenAPIHandler(busabaseRouter);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-upload-integrity-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-upload-integrity-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const prepare = async (body: Buffer) => {
    const input = {
      fileName: "archive.bin",
      mimeType: "application/octet-stream",
      sizeBytes: body.length,
      contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    };
    const upload = await client.assets.createUploadUrl(input);
    return { ...input, storageKey: upload.storageKey };
  };

  const confirmHttp = async (input: Awaited<ReturnType<typeof prepare>>) => {
    const result = await handler.handle(
      new Request("http://busabase.test/api/v1/assets/confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      { context: {} },
    );
    if (!result.matched) throw new Error("Asset confirmation HTTP route did not match");
    return result.response;
  };

  const registeredCounts = async () => ({
    assets: (await client.dump.exportTables({ table: "assets", limit: 2000 })).rows.length,
    attachments: (await client.dump.exportTables({ table: "attachments", limit: 2000 })).rows
      .length,
  });

  it("rejects missing and truncated old uploads without registering an attachment or Asset", async () => {
    const body = Buffer.from("the full bytes the caller intends to confirm");
    const input = await prepare(body);
    const baseline = await registeredCounts();

    expect((await confirmHttp(input)).status).toBe(400);
    expect(await registeredCounts()).toEqual(baseline);

    // Simulate an object written by the old relay after proxy buffering cut its body.
    await storage.uploadFileToKey(body.subarray(0, 8), input.storageKey, input.mimeType);
    const truncated = await confirmHttp(input);
    expect(truncated.status).toBe(400);
    expect((await truncated.json()).message).toContain("size does not match");
    expect(await registeredCounts()).toEqual(baseline);

    const relay = createDevUploadRoute({ verifyContentAddressedKey: true });
    expect(
      (
        await relay.PUT(
          new Request(
            `http://localhost/api/storage/upload?key=${encodeURIComponent(input.storageKey)}`,
            {
              method: "PUT",
              body,
            },
          ),
        )
      ).status,
    ).toBe(200);
    const response = await confirmHttp(input);
    expect(response.status).toBe(200);
    expect((await response.json()).assetId).toBeDefined();
    const registered = await registeredCounts();
    expect(registered.assets).toBe(baseline.assets + 1);
    expect(registered.attachments).toBe(baseline.attachments + 1);
  });

  it("rejects a same-size corrupted object even when its metadata matches", async () => {
    const body = Buffer.from("distinct bytes for checking the digest");
    const input = await prepare(body);
    const baseline = await registeredCounts();
    await storage.uploadFileToKey(Buffer.alloc(body.length, 1), input.storageKey, input.mimeType);

    const response = await confirmHttp(input);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("SHA-256");
    expect(await registeredCounts()).toEqual(baseline);
  });

  it("refuses a corrupt registered duplicate before creating another Asset", async () => {
    const body = Buffer.from("an existing registered attachment that an older relay truncated");
    const input = await prepare(body);
    await storage.uploadFileToKey(body, input.storageKey, input.mimeType);
    expect((await confirmHttp(input)).status).toBe(200);
    const baseline = await registeredCounts();
    const duplicateInput = {
      fileName: "same-content-again.bin",
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
    };

    // Simulate a bad object already registered by the released 1.2.0 relay.
    await storage.uploadFileToKey(body.subarray(0, 8), input.storageKey, input.mimeType);
    await expect(client.assets.createUploadUrl(duplicateInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("size does not match"),
    });
    await expect(client.assets.createMultipartUpload(duplicateInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await registeredCounts()).toEqual(baseline);

    await storage.uploadFileToKey(Buffer.alloc(body.length, 2), input.storageKey, input.mimeType);
    await expect(client.assets.createUploadUrl(duplicateInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("SHA-256"),
    });
    expect(await registeredCounts()).toEqual(baseline);

    await storage.uploadFileToKey(body, input.storageKey, input.mimeType);
    const duplicate = await runWithBusabaseContext(
      { spaceId: LOCAL_SPACE_ID, actorId: "another-space-manager", isSpaceManager: true },
      () => client.assets.createUploadUrl(duplicateInput),
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.assetId).toBeDefined();
    expect(await registeredCounts()).toEqual({
      assets: baseline.assets + 1,
      attachments: baseline.attachments,
    });
  });
});
