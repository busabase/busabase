import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * A TEXT update must not be able to replace a file whose bytes are an Asset.
 *
 * Before the guard this was accepted with HTTP 200: a real PNG took
 * `content: "oops"` and came back `encoding: "utf8"`, content `"oops"` — the
 * image gone, while `mimeType` still said `image/png`. Found while fixing the
 * mobile side (#7517), which stopped its own editor from sending it; this is
 * the server refusing it for every other caller — the public API, the CLI, and
 * any agent driving `fileTrees.createChangeRequest`.
 *
 * Driven through the real oRPC router against a real PGLite database and local
 * storage, because the whole point is what the write pipeline does, not what a
 * mocked one would.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

/** A real 1x1 PNG — small, but genuinely not text. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("fileTrees.createChangeRequest — text must not clobber an asset", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-clobber-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-clobber-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "clobber-drive",
      name: "Clobber Drive",
      files: [{ path: "notes.md", content: "# Notes\n" }],
    } as never);
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
    nodeId = drive.node.id;

    // Mount a real binary file alongside the text one.
    const requested = await client.assets.createUploadUrl({
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    } as never);
    const { storage } = await import("openlib/storage");
    await storage.uploadFileToKey(PNG, requested.storageKey, "image/png");
    const confirmed = await client.assets.confirm({
      storageKey: requested.storageKey,
      fileName: "logo.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    } as never);
    await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId,
      autoMerge: true,
      message: "add the logo",
      submittedBy: "local-editor",
      operations: [
        {
          kind: "create",
          path: "logo.png",
          assetId: confirmed.assetId ?? confirmed.id,
          mimeType: "image/png",
        },
      ],
    } as never);
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a text update aimed at an asset-backed file", async () => {
    await expect(
      client.fileTrees.createChangeRequest({
        type: "drive",
        nodeId,
        autoMerge: true,
        message: "typed into the box",
        submittedBy: "local-editor",
        operations: [{ kind: "update", path: "logo.png", content: "oops" }],
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("leaves the image exactly as it was", async () => {
    // The refusal has to happen BEFORE any write — a rejected request that
    // already replaced the file would be the same data loss with an error
    // message attached.
    const file = await client.fileTrees.readFile({
      type: "drive",
      nodeId,
      filePath: "logo.png",
    } as never);

    expect(file.encoding).toBe("url");
    expect(file.mimeType).toBe("image/png");
    expect(file.content).toBe("");
  });

  it("names the file it refused, so the caller can tell which one", async () => {
    await expect(
      client.fileTrees.createChangeRequest({
        type: "drive",
        nodeId,
        autoMerge: true,
        message: "typed into the box",
        submittedBy: "local-editor",
        operations: [{ kind: "update", path: "logo.png", content: "oops" }],
      } as never),
    ).rejects.toMatchObject({ message: expect.stringContaining("logo.png") });
  });

  it("still allows a text update to a text file", async () => {
    // The guard must be about what the file IS, not about tightening writes in
    // general.
    const cr = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId,
      autoMerge: true,
      message: "edit the notes",
      submittedBy: "local-editor",
      operations: [{ kind: "update", path: "notes.md", content: "# Notes\nupdated\n" }],
    } as never);
    expect(cr.id).toBeTruthy();

    const file = await client.fileTrees.readFile({
      type: "drive",
      nodeId,
      filePath: "notes.md",
    } as never);
    expect(file.content).toContain("updated");
  });

  it("still allows replacing the image with another asset", async () => {
    // Swapping one asset for another is exactly what an `assetId` operation is
    // for, and must stay reachable.
    const requested = await client.assets.createUploadUrl({
      fileName: "logo-v2.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    } as never);
    const { storage } = await import("openlib/storage");
    await storage.uploadFileToKey(PNG, requested.storageKey, "image/png");
    const confirmed = await client.assets.confirm({
      storageKey: requested.storageKey,
      fileName: "logo-v2.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    } as never);

    const cr = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId,
      autoMerge: true,
      message: "new logo",
      submittedBy: "local-editor",
      operations: [
        {
          kind: "update",
          path: "logo.png",
          assetId: confirmed.assetId ?? confirmed.id,
          mimeType: "image/png",
        },
      ],
    } as never);
    expect(cr.id).toBeTruthy();

    const file = await client.fileTrees.readFile({
      type: "drive",
      nodeId,
      filePath: "logo.png",
    } as never);
    expect(file.encoding).toBe("url");
  });

  it("still allows deleting it", async () => {
    // Delete does not pretend the bytes were text, so it is untouched.
    const cr = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId,
      autoMerge: true,
      message: "drop the logo",
      submittedBy: "local-editor",
      operations: [{ kind: "delete", path: "logo.png" }],
    } as never);
    expect(cr.id).toBeTruthy();
  });
});
