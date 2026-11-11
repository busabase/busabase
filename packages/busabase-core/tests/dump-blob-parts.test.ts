import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { LocalStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { attachments } from "../src/db/schema";
import {
  RESTORE_BLOB_PART_BYTES,
  RestoreBlobParts,
} from "../src/domains/dump/logic/restore-blob-parts";
import {
  cleanupAbandonedRestoreBlobs,
  type RestoreBlobReceipt,
  restoreReceiptPrefix,
  writeRestoreBlobReceipt,
} from "../src/domains/dump/logic/restore-blob-receipts";
import { busabaseRouter } from "../src/router";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const split = (key: string, bytes: Buffer, hash = sha(bytes)) =>
  Array.from({ length: Math.ceil(bytes.length / RESTORE_BLOB_PART_BYTES) }, (_, index) => ({
    storageKey: key,
    mimeType: "application/octet-stream",
    base64: bytes
      .subarray(index * RESTORE_BLOB_PART_BYTES, (index + 1) * RESTORE_BLOB_PART_BYTES)
      .toString("base64"),
    chunk: {
      partNumber: index + 1,
      totalParts: Math.ceil(bytes.length / RESTORE_BLOB_PART_BYTES),
      sizeBytes: bytes.length,
      sha256: hash,
    },
  }));

describe("large dump blobs — real local multipart storage and PGLite", () => {
  let dataDir: string;
  let storageDir: string;
  let previousCwd: string;
  const client = createRouterClient(busabaseRouter);
  const inSpace = <T>(spaceId: string, run: () => Promise<T>) =>
    runWithBusabaseContext({ spaceId }, run);
  beforeAll(async () => {
    previousCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-parts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-parts-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(previousCwd);
    for (const dir of [dataDir, storageDir]) await rm(dir, { recursive: true, force: true });
  });

  it("keeps the original key absent until every part validates, accepting an identical retried part", async () => {
    const spaceId = "dump_parts_complete";
    await inSpace(spaceId, async () => {
      const begun = await client.dump.importBegin({ sourceSpaceId: "original" });
      expect(begun.blobChunkProtocol).toBe(1);
      const bytes = Buffer.alloc(RESTORE_BLOB_PART_BYTES * 2 + 37, 57);
      const key = "attachments/parts-complete.bin";
      const rows = split(key, bytes);
      const send = (row: (typeof rows)[number]) =>
        client.dump.importTables({
          sessionId: begun.sessionId,
          table: "attachmentBlobs",
          rows: [row],
        });
      expect(await send(rows[0])).toEqual({ inserted: 0 });
      expect(await send(rows[0])).toEqual({ inserted: 0 });
      expect(await storage.objectExists(key)).toBe(false);
      await expect(send(rows[2])).rejects.toThrow(/out of sequence/);
      await send(rows[1]);
      expect(await storage.objectExists(key)).toBe(false);
      expect(await send(rows[2])).toEqual({ inserted: 1 });
      expect(await send(rows[2])).toEqual({ inserted: 1 });
      expect((await storage.getObject(key)).equals(bytes)).toBe(true);
      await client.dump.importAbort({ sessionId: begun.sessionId });
      expect((await readdir(path.join(storageDir, ".tmp/multipart"))).length).toBe(0);
    });
  });

  it("accepts a complete v1 duplicate blob replay without new uploads and rejects changed replay bytes", async () => {
    const spaceId = "dump_parts_full_replay";
    await inSpace(spaceId, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: "original" });
      const bytes = Buffer.alloc(RESTORE_BLOB_PART_BYTES * 2 + 31, 52);
      const key = "attachments/full-replay.bin";
      const rows = split(key, bytes);
      const created = vi.spyOn(LocalStorage.prototype, "createMultipartUpload");
      const writes = vi.spyOn(LocalStorage.prototype, "writeMultipartPart");
      const send = (row: (typeof rows)[number]) =>
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [row] });
      try {
        for (const [index, row] of rows.entries())
          expect((await send(row)).inserted).toBe(index === rows.length - 1 ? 1 : 0);
        expect(created).toHaveBeenCalledTimes(1);
        expect(writes).toHaveBeenCalledTimes(3);
        for (const [index, row] of rows.entries())
          expect((await send(row)).inserted).toBe(index === rows.length - 1 ? 1 : 0);
        expect(created).toHaveBeenCalledTimes(1);
        expect(writes).toHaveBeenCalledTimes(3);
        expect(sha(await storage.getObject(key))).toBe(sha(bytes));
        const changed = Buffer.from(bytes.subarray(0, RESTORE_BLOB_PART_BYTES));
        changed[0] ^= 1;
        await expect(send({ ...rows[0], base64: changed.toString("base64") })).rejects.toThrow(
          /differs from the completed object/,
        );
        await expect(
          send({ ...rows[0], chunk: { ...rows[0].chunk, sha256: "0".repeat(64) } }),
        ).rejects.toThrow(/metadata changed/);
        await expect(send({ ...rows[0], mimeType: "text/plain" })).rejects.toThrow(
          /metadata changed/,
        );
        await expect(
          send({ ...rows[0], chunk: { ...rows[0].chunk, sizeBytes: rows[0].chunk.sizeBytes + 1 } }),
        ).rejects.toThrow(/metadata changed/);
        await expect(
          send({ ...rows[0], chunk: { ...rows[0].chunk, totalParts: 4 } }),
        ).rejects.toThrow(/Invalid restore blob chunk metadata/);
        expect(sha(await storage.getObject(key))).toBe(sha(bytes));
        expect(created).toHaveBeenCalledTimes(1);
        expect(await readdir(path.join(storageDir, ".tmp/multipart"))).toEqual([]);
      } finally {
        created.mockRestore();
        writes.mockRestore();
        await client.dump.importAbort({ sessionId });
      }
    });
  });

  it("restores a large extracted-text object with the same bounded staging protocol", async () => {
    const spaceId = "dump_parts_text";
    await inSpace(spaceId, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: "original" });
      const bytes = Buffer.alloc(RESTORE_BLOB_PART_BYTES + 17, 65);
      const hash = sha(bytes);
      const key = `asset-texts/blobs/sha256/${hash.slice(0, 2)}/${hash}.txt`;
      for (const part of split(key, bytes)) {
        const { storageKey, ...row } = part;
        await client.dump.importTables({
          sessionId,
          table: "assetTextBlobs",
          rows: [{ ...row, textStorageKey: storageKey }],
        });
      }
      expect(sha(await storage.getObject(key))).toBe(hash);
      await client.dump.importAbort({ sessionId });
    });
  });

  it("blocks commit of an unfinished object and removes staged parts on abort", async () => {
    const spaceId = "dump_parts_abort";
    await inSpace(spaceId, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: "original" });
      const key = "attachments/parts-aborted.bin";
      const rows = split(key, Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 9));
      await client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] });
      await expect(client.dump.importCommit({ sessionId })).rejects.toThrow(/incomplete multipart/);
      expect(await storage.objectExists(key)).toBe(false);
      await client.dump.importAbort({ sessionId });
      expect((await readdir(path.join(storageDir, ".tmp/multipart"))).length).toBe(0);
      await expect(
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[1]] }),
      ).rejects.toThrow(/not found|expired/);
    });
  });

  it("rejects an incorrect final SHA without changing the original object", async () => {
    const spaceId = "dump_parts_bad_hash";
    await inSpace(spaceId, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: "original" });
      const key = "attachments/parts-preserve.bin";
      const original = Buffer.from("keep this existing object");
      await storage.uploadFileToKey(original, key, "application/octet-stream");
      const rows = split(key, Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 3), "0".repeat(64));
      await client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] });
      await expect(
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[1]] }),
      ).rejects.toThrow(/content hash or size/);
      expect(await storage.getObject(key)).toEqual(original);
      expect((await readdir(path.join(storageDir, ".tmp/multipart"))).length).toBe(0);
      await client.dump.importAbort({ sessionId });
    });
  });

  it("checks the actual assembled storage bytes before promoting, not just the received part hashes", async () => {
    const spaceId = "dump_parts_stored_corruption";
    await inSpace(spaceId, async () => {
      const { sessionId } = await client.dump.importBegin({ sourceSpaceId: "original" });
      const key = "attachments/parts-corrupt-store.bin";
      const rows = split(key, Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 7));
      const write = LocalStorage.prototype.writeMultipartPart;
      const corrupt = vi
        .spyOn(LocalStorage.prototype, "writeMultipartPart")
        .mockImplementationOnce(function (storageKey, uploadId, partNumber, body, options) {
          const changed = Buffer.from(body as Buffer);
          changed[0] ^= 1;
          return write.call(this, storageKey, uploadId, partNumber, changed, options);
        });
      try {
        await client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] });
        await expect(
          client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[1]] }),
        ).rejects.toThrow(/Stored restore object content hash/);
        expect(await storage.objectExists(key)).toBe(false);
      } finally {
        corrupt.mockRestore();
        await client.dump.importAbort({ sessionId });
      }
    });
  });

  it("binds parts and cleanup to their session space and refuses foreign referenced keys", async () => {
    const owner = "dump_parts_owner";
    const foreign = "dump_parts_foreign";
    const { sessionId } = await inSpace(owner, () =>
      client.dump.importBegin({ sourceSpaceId: "original" }),
    );
    const key = "attachments/parts-owned-by-another.bin";
    const rows = split(key, Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 2));
    await (await getDb()).insert(attachments).values({
      id: "att_parts_foreign",
      userId: "foreign-owner",
      spaceId: foreign,
      storageKey: key,
      fileName: "foreign.bin",
      mimeType: "application/octet-stream",
      sizeBytes: RESTORE_BLOB_PART_BYTES + 1,
    });
    await expect(
      inSpace(foreign, () =>
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] }),
      ),
    ).rejects.toThrow(/different space/);
    await expect(inSpace(foreign, () => client.dump.importAbort({ sessionId }))).rejects.toThrow(
      /different space/,
    );
    await expect(
      inSpace(owner, () =>
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] }),
      ),
    ).rejects.toThrow(/another space/);
    const invalid = { ...rows[0], storageKey: "attachments/../outside" };
    await expect(
      inSpace(owner, () =>
        client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [invalid] }),
      ),
    ).rejects.toThrow(/Invalid chunked restore storage key/);
    await inSpace(owner, () => client.dump.importAbort({ sessionId }));
  });

  it("waits for a remote owner's fresh lease, then cleans expired receipts without touching another space", async () => {
    const spaceId = "dump_parts_remote_lease";
    const transfer = new RestoreBlobParts("dumpsess_remote_lease", spaceId);
    const foreign = new RestoreBlobParts("dumpsess_remote_foreign", "dump_parts_remote_foreign");
    const bytes = Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 6);
    const row = split("attachments/remote-pending.bin", bytes)[0];
    const input = {
      key: row.storageKey,
      mimeType: row.mimeType,
      base64: row.base64,
      chunk: row.chunk,
      validate: async () => undefined,
      promote: async () => undefined,
    };
    await transfer.accept(input);
    await foreign.accept({ ...input, key: "attachments/foreign-remote-pending.bin" });
    const objects = (await storage.listObjects(restoreReceiptPrefix(spaceId))).objects;
    const receiptKey = objects.find((object) => object.key.endsWith("/receipt.json"))?.key;
    expect(receiptKey).toBeTruthy();
    const receipt = JSON.parse(
      (await storage.getObject(receiptKey as string)).toString(),
    ) as RestoreBlobReceipt;
    receipt.owner.host = "a-different-host";
    await writeRestoreBlobReceipt(receiptKey as string, receipt);
    await cleanupAbandonedRestoreBlobs(spaceId, new Set());
    expect(await storage.objectExists(receiptKey as string)).toBe(true);
    receipt.leaseExpiresAt = Date.now() - 1;
    await writeRestoreBlobReceipt(receiptKey as string, receipt);
    await cleanupAbandonedRestoreBlobs(spaceId, new Set());
    expect(await storage.objectExists(receiptKey as string)).toBe(false);
    expect(
      (await storage.listObjects(restoreReceiptPrefix("dump_parts_remote_foreign"))).objects.some(
        (object) => object.key.endsWith("/receipt.json"),
      ),
    ).toBe(true);
    await transfer.cleanup();
    await foreign.cleanup();
  });

  it("cleans expired multipart state and resumes by starting fresh parts in a new session", async () => {
    const spaceId = "dump_parts_expiry";
    const key = "attachments/parts-expired.bin";
    const rows = split(key, Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 5));
    const { sessionId } = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: "original" }),
    );
    await inSpace(spaceId, () =>
      client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[0]] }),
    );
    const date = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61 * 60 * 1000);
    let resumed = "";
    try {
      resumed = (
        await inSpace(spaceId, () =>
          client.dump.importBegin({ sourceSpaceId: "original", resume: true }),
        )
      ).sessionId;
      expect((await readdir(path.join(storageDir, ".tmp/multipart"))).length).toBe(0);
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({ sessionId, table: "attachmentBlobs", rows: [rows[1]] }),
        ),
      ).rejects.toThrow(/not found|expired/);
      for (const row of rows)
        await inSpace(spaceId, () =>
          client.dump.importTables({ sessionId: resumed, table: "attachmentBlobs", rows: [row] }),
        );
      expect(sha(await storage.getObject(key))).toBe(rows[0].chunk.sha256);
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId: resumed }));
    } finally {
      date.mockRestore();
    }
  });
});
