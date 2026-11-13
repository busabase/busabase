import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { LocalStorage, resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { closeDb, getDb } from "../src/db";
import { attachments, busabaseAssets, busabaseAssetTexts } from "../src/db/schema";
import { isRestoreAutomationBlocked } from "../src/domains/dump/logic/restore-activity";
import {
  RESTORE_BLOB_PART_BYTES,
  RestoreBlobParts,
} from "../src/domains/dump/logic/restore-blob-parts";
import { restoreReceiptPrefix } from "../src/domains/dump/logic/restore-blob-receipts";
import { busabaseRouter } from "../src/router";
import { createExactDumpReplayFixture } from "./helpers/exact-dump-replay";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const client = createRouterClient(busabaseRouter);
const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId }, work);
type Blob = { key: string; bytes: Buffer; table?: "attachmentBlobs" | "assetTextBlobs" };

describe("fresh restore rolls back only its new promoted objects with real storage and PGlite", () => {
  let cwd: string,
    dataDir: string,
    storageDir: string,
    sequence = 0;
  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-promotion-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-promotion-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    resetStorage();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await closeDb();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(cwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });
  const start = async () => {
    const spaceId = `promotion-target-${++sequence}`;
    const { sessionId } = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId }),
    );
    return { spaceId, sessionId };
  };
  const upload = (spaceId: string, sessionId: string, blob: Blob) =>
    inSpace(spaceId, async () => {
      const table = blob.table ?? "attachmentBlobs";
      const totalParts = Math.max(1, Math.ceil(blob.bytes.length / RESTORE_BLOB_PART_BYTES));
      for (let index = 0; index < totalParts; index++) {
        const result = await client.dump.importTables({
          sessionId,
          table,
          rows: [
            {
              ...(table === "attachmentBlobs"
                ? { storageKey: blob.key }
                : { textStorageKey: blob.key }),
              base64: blob.bytes
                .subarray(index * RESTORE_BLOB_PART_BYTES, (index + 1) * RESTORE_BLOB_PART_BYTES)
                .toString("base64"),
              chunk: {
                partNumber: index + 1,
                totalParts,
                sizeBytes: blob.bytes.length,
                sha256: sha(blob.bytes),
              },
            },
          ],
        });
        expect(result.inserted).toBe(index === totalParts - 1 ? 1 : 0);
      }
    });
  const registration = (id: string, spaceId: string, key: string, bytes: Buffer) => ({
    id,
    spaceId,
    storageKey: key,
    fileName: "fixture.bin",
    mimeType: "application/octet-stream",
    sizeBytes: bytes.length,
    contentHash: `sha256:${sha(bytes)}`,
    userId: "fixture-owner",
  });

  it("cleans all four new final keys after a later foreign SQL id refuses the restore", async () => {
    const { spaceId, sessionId } = await start(),
      db = await getDb();
    const original = Buffer.from("untouched original foreign object"),
      foreignKey = `attachments/promotion-foreign-${sequence}.bin`;
    const foreignId = `att_promotion_collision_${sequence}`;
    await storage.uploadFileToKey(original, foreignKey, "application/octet-stream");
    await db.insert(attachments).values({
      ...registration(foreignId, "foreign-space", foreignKey, original),
      metadata: { private: "foreign registration" },
    });
    const before = await db.select().from(attachments).where(eq(attachments.id, foreignId));
    const blobs: Blob[] = [
      { key: `attachments/promotion-${sequence}-empty.bin`, bytes: Buffer.alloc(0) },
      {
        key: `attachments/promotion-${sequence}-large.bin`,
        bytes: Buffer.alloc(13 * 1024 * 1024 + 37, 63),
      },
      {
        key: `asset-texts/promotion-${sequence}-empty.txt`,
        bytes: Buffer.alloc(0),
        table: "assetTextBlobs",
      },
      {
        key: `asset-texts/promotion-${sequence}-small.txt`,
        bytes: Buffer.from("derived 中文 text"),
        table: "assetTextBlobs",
      },
    ];
    for (const blob of blobs) await upload(spaceId, sessionId, blob);
    for (const blob of blobs) {
      const stored = await storage.getObject(blob.key);
      expect(stored.equals(blob.bytes)).toBe(true);
      expect(sha(stored)).toBe(sha(blob.bytes));
    }
    await expect(
      inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachments",
          rows: [registration(foreignId, spaceId, blobs[1].key, blobs[1].bytes)],
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    for (const blob of blobs) expect(await storage.getObjectMetadata(blob.key)).toBeNull();
    expect(await db.select().from(attachments).where(eq(attachments.id, foreignId))).toEqual(
      before,
    );
    expect(await storage.getObject(foreignKey)).toEqual(original);
    expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("cleans new bytes after their own imported registrations are removed, retaining a preexisting object", async () => {
    const { spaceId, sessionId } = await start();
    const bytes = Buffer.from("same verified bytes"),
      created = `attachments/promotion-${sequence}-new.bin`,
      old = `attachments/promotion-${sequence}-old.bin`;
    await storage.uploadFileToKey(bytes, old, "application/octet-stream");
    for (const key of [created, old]) {
      await upload(spaceId, sessionId, { key, bytes });
      await inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachments",
          rows: [
            registration(
              `att_promotion_${sequence}_${key === created ? "new" : "old"}`,
              spaceId,
              key,
              bytes,
            ),
          ],
        }),
      );
    }
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect(await storage.getObjectMetadata(created)).toBeNull();
    expect(await storage.getObject(old)).toEqual(bytes);
    expect(
      await (await getDb()).select().from(attachments).where(eq(attachments.spaceId, spaceId)),
    ).toEqual([]);
  });

  it.each(["attachment", "text"] as const)(
    "preserves a new object adopted by another space's %s registration",
    async (kind) => {
      const { spaceId, sessionId } = await start(),
        db = await getDb(),
        bytes = Buffer.from("newly adopted bytes");
      const key = `${kind === "attachment" ? "attachments" : "asset-texts"}/promotion-adopted-${sequence}.bin`;
      await upload(spaceId, sessionId, {
        key,
        bytes,
        table: kind === "attachment" ? "attachmentBlobs" : "assetTextBlobs",
      });
      if (kind === "attachment")
        await db
          .insert(attachments)
          .values(registration(`att_promotion_adopted_${sequence}`, "other-space", key, bytes));
      else {
        const assetId = `ast_promotion_adopted_${sequence}`;
        await db.insert(busabaseAssets).values({
          id: assetId,
          spaceId: "other-space",
          attachmentId: "other-source",
          name: "Other text",
        });
        await db.insert(busabaseAssetTexts).values({
          id: `atx_promotion_adopted_${sequence}`,
          spaceId: "other-space",
          assetId,
          textStorageKey: key,
          writtenBy: "other-writer",
        });
      }
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
      expect(await storage.getObject(key)).toEqual(bytes);
    },
  );

  it.each(["same length", "different length"] as const)(
    "preserves an unregistered object whose bytes were independently replaced with %s content",
    async (kind) => {
      const { spaceId, sessionId } = await start(),
        key = `attachments/promotion-changed-${sequence}.bin`,
        bytes = Buffer.from("first version"),
        changed =
          kind === "same length"
            ? Buffer.from("other version")
            : Buffer.from("independent replacement is larger");
      if (kind === "same length") expect(changed.length).toBe(bytes.length);
      await upload(spaceId, sessionId, { key, bytes });
      await storage.uploadFileToKey(changed, key, "application/octet-stream");
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
      expect(await storage.getObject(key)).toEqual(changed);
    },
  );

  it("cleans a copy that published the new final object before throwing", async () => {
    const { spaceId, sessionId } = await start(),
      key = `attachments/promotion-threw-${sequence}.bin`,
      bytes = Buffer.from("copy published before failure");
    const original = LocalStorage.prototype.copyObject;
    const fail = vi
      .spyOn(LocalStorage.prototype, "copyObject")
      .mockImplementationOnce(async function (source, destination) {
        await original.call(this, source, destination);
        throw new Error("Synthetic post-publication failure");
      });
    try {
      await expect(upload(spaceId, sessionId, { key, bytes })).rejects.toThrow(/post-publication/);
    } finally {
      fail.mockRestore();
    }
    expect(await storage.getObject(key)).toEqual(bytes);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect(await storage.getObjectMetadata(key)).toBeNull();
  });

  it("keeps failed deletion recoverable and retries only the remaining exact key", async () => {
    const { spaceId, sessionId } = await start(),
      key = `attachments/promotion-delete-retry-${sequence}.bin`,
      bytes = Buffer.from("retry exact cleanup");
    await upload(spaceId, sessionId, { key, bytes });
    const original = LocalStorage.prototype.deleteObject;
    const fail = vi
      .spyOn(LocalStorage.prototype, "deleteObject")
      .mockImplementation(async function (value) {
        if (value === key) throw new Error("Synthetic provider deletion failure");
        return original.call(this, value);
      });
    try {
      await expect(inSpace(spaceId, () => client.dump.importAbort({ sessionId }))).rejects.toThrow(
        /deletion failure/,
      );
    } finally {
      fail.mockRestore();
    }
    expect(await storage.getObject(key)).toEqual(bytes);
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(true);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect(await storage.getObjectMetadata(key)).toBeNull();
    expect(await isRestoreAutomationBlocked(spaceId)).toBe(false);
  });

  it("does not let an old abort delete promoted progress after same-archive resume takes ownership", async () => {
    const spaceId = `promotion-handoff-${++sequence}`,
      key = `attachments/promotion-handoff-${sequence}.bin`,
      bytes = Buffer.from("keep resumed progress");
    const archive = createExactDumpReplayFixture({
      sourceSpaceId: spaceId,
      blobs: [{ key, bytes }],
    });
    const first = await inSpace(spaceId, () => archive.begin(client));
    await upload(spaceId, first.sessionId, { key, bytes });
    let release!: () => void, enteredA!: () => void, enteredB!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      a = new Promise<void>((resolve) => {
        enteredA = resolve;
      }),
      b = new Promise<void>((resolve) => {
        enteredB = resolve;
      });
    const cleanup = RestoreBlobParts.prototype.cleanup;
    let calls = 0;
    const held = vi.spyOn(RestoreBlobParts.prototype, "cleanup").mockImplementation(async function (
      this: RestoreBlobParts,
    ) {
      if (++calls <= 2) {
        if (calls === 1) enteredA();
        else enteredB();
        await gate;
      }
      return cleanup.call(this);
    });
    const aborting = inSpace(spaceId, () =>
      client.dump.importAbort({ sessionId: first.sessionId }),
    ).then(
      () => null,
      (error) => error,
    );
    await a;
    const resuming = inSpace(spaceId, () => archive.begin(client, { resume: true }));
    await b;
    release();
    let resumed: Awaited<typeof resuming>;
    try {
      resumed = await resuming;
      expect(await aborting).toMatchObject({ code: "CONFLICT" });
    } finally {
      held.mockRestore();
      release();
    }
    expect(await storage.getObject(key)).toEqual(bytes);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
    expect(await storage.getObject(key)).toEqual(bytes);
  });

  it("stops a same-session publication and completion once explicit abort begins", async () => {
    const { spaceId, sessionId } = await start(),
      key = `attachments/promotion-aborting-${sequence}.bin`,
      bytes = Buffer.from("do not publish while aborting");
    let release!: () => void, entered!: () => void, aborting!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      completed = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      cleanupStarted = new Promise<void>((resolve) => {
        aborting = resolve;
      });
    const complete = LocalStorage.prototype.completeMultipartUpload,
      cleanup = RestoreBlobParts.prototype.cleanup;
    const held = vi
      .spyOn(LocalStorage.prototype, "completeMultipartUpload")
      .mockImplementationOnce(async function (...args) {
        await complete.apply(this, args);
        entered();
        await gate;
      });
    const cleanupProbe = vi
      .spyOn(RestoreBlobParts.prototype, "cleanup")
      .mockImplementation(async function (this: RestoreBlobParts) {
        aborting();
        return cleanup.call(this);
      });
    const uploading = upload(spaceId, sessionId, { key, bytes }).then(
      () => null,
      (error) => error,
    );
    await completed;
    const abort = inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    await cleanupStarted;
    try {
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({ sessionId, table: "attachments", rows: [] }),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        inSpace(spaceId, () => client.dump.importCommit({ sessionId })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      release();
    }
    try {
      expect(await uploading).toMatchObject({ code: "CONFLICT" });
      expect(await abort).toEqual({ ok: true });
    } finally {
      held.mockRestore();
      cleanupProbe.mockRestore();
      release();
    }
    expect(await storage.getObjectMetadata(key)).toBeNull();
    expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
  });
});
