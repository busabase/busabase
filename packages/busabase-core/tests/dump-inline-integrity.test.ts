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
import { enqueueStorageCleanup } from "../src/domains/assets/logic/storage-cleanup-logic";
import { datePreservingColumns } from "../src/domains/dump/logic/import-row-values";
import { restoreReceiptPrefix } from "../src/domains/dump/logic/restore-blob-receipts";
import { busabaseRouter } from "../src/router";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const client = createRouterClient(busabaseRouter);
const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId }, work);
const chunk = (bytes: Buffer) => ({
  partNumber: 1,
  totalParts: 1,
  sizeBytes: bytes.length,
  sha256: sha(bytes),
});

describe("legacy inline restore uses protected staging with real PGlite and storage", () => {
  let cwd: string,
    dataDir: string,
    storageDir: string,
    sequence = 0;
  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inline-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inline-storage-"));
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
    const spaceId = `inline-target-${++sequence}`;
    const { sessionId } = await inSpace(spaceId, () =>
      client.dump.importBegin({ sourceSpaceId: spaceId }),
    );
    return { spaceId, sessionId };
  };

  it.each(["attachmentBlobs", "assetTextBlobs"] as const)(
    "refuses foreign %s bytes in both inline and chunk requests and preserves all original data",
    async (table) => {
      const { spaceId, sessionId } = await start(),
        owner = `foreign-owner-${sequence}`;
      const old = Buffer.from("Original foreign bytes"),
        incoming = Buffer.from("must never overwrite");
      const key = `${table === "attachmentBlobs" ? "attachments" : "asset-texts"}/inline-foreign-${sequence}.txt`;
      const db = await getDb();
      let original: unknown;
      if (table === "attachmentBlobs") {
        await db.insert(attachments).values({
          id: `att_inline_foreign_${sequence}`,
          spaceId: owner,
          userId: "private-owner",
          context: "private-context",
          metadata: { private: "not ours" },
          storageKey: key,
          fileName: "original.txt",
          mimeType: "text/plain",
          sizeBytes: old.length,
          contentHash: `sha256:${sha(old)}`,
        });
        original = await db
          .select(datePreservingColumns(attachments))
          .from(attachments)
          .where(eq(attachments.storageKey, key));
      } else {
        const assetId = `ast_inline_foreign_${sequence}`;
        await db.insert(busabaseAssets).values({
          id: assetId,
          spaceId: owner,
          attachmentId: "missing_source_registry",
          name: "Foreign text",
        });
        await db.insert(busabaseAssetTexts).values({
          id: `atx_inline_foreign_${sequence}`,
          spaceId: owner,
          assetId,
          textStorageKey: key,
          textContentHash: `sha256:${sha(old)}`,
          byteCount: old.length,
          writtenBy: "private-writer",
        });
        original = await db
          .select(datePreservingColumns(busabaseAssetTexts))
          .from(busabaseAssetTexts)
          .where(eq(busabaseAssetTexts.textStorageKey, key));
      }
      await storage.uploadFileToKey(old, key, "text/plain");
      for (const chunked of [false, true])
        await expect(
          inSpace(spaceId, () =>
            client.dump.importTables({
              sessionId,
              table,
              rows: [
                {
                  ...(table === "attachmentBlobs" ? { storageKey: key } : { textStorageKey: key }),
                  base64: incoming.toString("base64"),
                  ...(chunked ? { chunk: chunk(incoming) } : {}),
                },
              ],
            }),
          ),
        ).rejects.toThrow(/another space/);
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
      expect(await storage.getObject(key)).toEqual(old);
      const after =
        table === "attachmentBlobs"
          ? await db
              .select(datePreservingColumns(attachments))
              .from(attachments)
              .where(eq(attachments.storageKey, key))
          : await db
              .select(datePreservingColumns(busabaseAssetTexts))
              .from(busabaseAssetTexts)
              .where(eq(busabaseAssetTexts.textStorageKey, key));
      expect(after).toEqual(original);
      expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
    },
  );

  it.each(["attachmentBlobs", "assetTextBlobs"] as const)(
    "restores and exactly replays zero-byte %s without invalid byte ranges",
    async (table) => {
      const { spaceId, sessionId } = await start(),
        key = `${table === "attachmentBlobs" ? "attachments" : "asset-texts"}/zero-${sequence}.txt`;
      const range = vi.spyOn(LocalStorage.prototype, "getObjectRange");
      try {
        for (const chunked of [false, true, false])
          expect(
            await inSpace(spaceId, () =>
              client.dump.importTables({
                sessionId,
                table,
                rows: [
                  {
                    ...(table === "attachmentBlobs"
                      ? { storageKey: key }
                      : { textStorageKey: key }),
                    base64: "",
                    ...(chunked ? { chunk: chunk(Buffer.alloc(0)) } : {}),
                  },
                ],
              }),
            ),
          ).toEqual({ inserted: 1 });
        expect(await storage.getObject(key)).toEqual(Buffer.alloc(0));
        expect(range).not.toHaveBeenCalled();
      } finally {
        range.mockRestore();
        await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
      }
      expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
    },
  );

  it("rejects invalid prefix/base64 before upload and cleans a failed empty hash without damaging an existing object", async () => {
    const { spaceId, sessionId } = await start(),
      key = `attachments/inline-invalid-${sequence}.txt`,
      old = Buffer.from("keep original");
    await storage.uploadFileToKey(old, key, "text/plain");
    const created = vi.spyOn(LocalStorage.prototype, "createMultipartUpload");
    for (const base64 of ["YQ", "YQ==\n", "YR==", "===="])
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "attachmentBlobs",
            rows: [{ storageKey: key, base64 }],
          }),
        ),
      ).rejects.toThrow(/base64/);
    await expect(
      inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachmentBlobs",
          rows: [{ storageKey: "attachments/../outside", base64: "" }],
        }),
      ),
    ).rejects.toThrow(/Invalid.*key/);
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
    await expect(
      inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachmentBlobs",
          rows: [
            {
              storageKey: key,
              base64: "",
              chunk: { ...chunk(Buffer.alloc(0)), sha256: "0".repeat(64) },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/hash/);
    expect(await storage.getObject(key)).toEqual(old);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
  });

  it("checks retirement under the promotion fence before touching the final inline object", async () => {
    const { spaceId, sessionId } = await start(),
      key = `attachments/inline-fenced-${sequence}.txt`,
      old = Buffer.from("original final object");
    await storage.uploadFileToKey(old, key, "text/plain");
    const complete = LocalStorage.prototype.completeMultipartUpload;
    const race = vi
      .spyOn(LocalStorage.prototype, "completeMultipartUpload")
      .mockImplementationOnce(async function (...args) {
        await complete.apply(this, args);
        await enqueueStorageCleanup(await getDb(), {
          storageKey: key,
          spaceId,
          kind: "attachment",
        });
      });
    try {
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "attachmentBlobs",
            rows: [{ storageKey: key, base64: Buffer.from("replacement").toString("base64") }],
          }),
        ),
      ).rejects.toThrow(/expired/);
    } finally {
      race.mockRestore();
    }
    expect(await storage.getObject(key)).toEqual(old);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect((await storage.listObjects(restoreReceiptPrefix(spaceId))).objects).toEqual([]);
  });

  it.each(["matching SHA", "missing SHA", "different SHA"] as const)(
    "handles an original size-statistic deviation with %s without rewriting its registration",
    async (kind) => {
      const { spaceId, sessionId } = await start(),
        key = `attachments/inline-stat-${sequence}.png`,
        bytes = Buffer.from("actual source bytes"),
        old = Buffer.from("keep until verified");
      const db = await getDb(),
        id = `att_inline_stat_${sequence}`;
      await db.insert(attachments).values({
        id,
        spaceId,
        userId: "original-owner",
        context: "original-context",
        metadata: { original: true },
        storageKey: key,
        fileName: "source.png",
        mimeType: "image/png",
        sizeBytes: bytes.length + 7,
        contentHash:
          kind === "matching SHA"
            ? `sha256:${sha(bytes)}`
            : kind === "missing SHA"
              ? null
              : `sha256:${sha(old)}`,
      });
      const before = await db
        .select(datePreservingColumns(attachments))
        .from(attachments)
        .where(eq(attachments.id, id));
      await storage.uploadFileToKey(old, key, "image/png");
      const call = () =>
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "attachmentBlobs",
            rows: [{ storageKey: key, base64: bytes.toString("base64") }],
          }),
        );
      if (kind === "matching SHA") {
        expect(await call()).toEqual({ inserted: 1 });
        expect(await storage.getObject(key)).toEqual(bytes);
      } else {
        await expect(call()).rejects.toThrow(/hash|size/);
        expect(await storage.getObject(key)).toEqual(old);
      }
      expect(
        await db
          .select(datePreservingColumns(attachments))
          .from(attachments)
          .where(eq(attachments.id, id)),
      ).toEqual(before);
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    },
  );

  it("does not mint a foreign or unassigned file capability by importing a loose Asset reference", async () => {
    const { spaceId, sessionId } = await start(),
      db = await getDb(),
      bytes = Buffer.from("private file");
    for (const owner of ["other-space", null]) {
      const suffix = owner ?? "unassigned",
        id = `att_inline_ref_${sequence}_${suffix}`,
        assetId = `ast_inline_ref_${sequence}_${suffix}`,
        key = `attachments/foreign-ref-${sequence}-${suffix}.txt`;
      await db.insert(attachments).values({
        id,
        spaceId: owner,
        userId: "other-user",
        storageKey: key,
        fileName: "private.txt",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        metadata: { private: "do not expose" },
      });
      await storage.uploadFileToKey(bytes, key, "text/plain");
      const before = await db
        .select(datePreservingColumns(attachments))
        .from(attachments)
        .where(eq(attachments.id, id));
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "assets",
            rows: [{ id: assetId, spaceId, attachmentId: id, name: "Forged pointer" }],
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await db.select().from(busabaseAssets).where(eq(busabaseAssets.id, assetId))).toEqual(
        [],
      );
      await expect(inSpace(spaceId, () => client.assets.get({ assetId }))).rejects.toThrow(
        /not found/i,
      );
      expect(await storage.getObject(key)).toEqual(bytes);
      expect(
        await db
          .select(datePreservingColumns(attachments))
          .from(attachments)
          .where(eq(attachments.id, id)),
      ).toEqual(before);
    }
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
  });

  it("replays an already correct unknown-hash stale-size object without writing or correcting its PO", async () => {
    const { spaceId, sessionId } = await start(),
      db = await getDb(),
      bytes = Buffer.from("verified original PNG bytes"),
      key = `attachments/stale-null-${sequence}.png`,
      id = `att_stale_null_${sequence}`;
    await db.insert(attachments).values({
      id,
      spaceId,
      userId: "original-owner",
      storageKey: key,
      fileName: "original.png",
      mimeType: "image/png",
      sizeBytes: bytes.length + 23,
      contentHash: null,
      metadata: { originalStatistic: true },
    });
    await storage.uploadFileToKey(bytes, key, "image/png");
    const before = await db
      .select(datePreservingColumns(attachments))
      .from(attachments)
      .where(eq(attachments.id, id));
    const created = vi.spyOn(LocalStorage.prototype, "createMultipartUpload"),
      copied = vi.spyOn(LocalStorage.prototype, "copyObject");
    try {
      for (const chunked of [true, false])
        expect(
          await inSpace(spaceId, () =>
            client.dump.importTables({
              sessionId,
              table: "attachmentBlobs",
              rows: [
                {
                  storageKey: key,
                  mimeType: "image/png",
                  base64: bytes.toString("base64"),
                  ...(chunked ? { chunk: chunk(bytes) } : {}),
                },
              ],
            }),
          ),
        ).toEqual({ inserted: 1 });
      expect(created).not.toHaveBeenCalled();
      expect(copied).not.toHaveBeenCalled();
    } finally {
      created.mockRestore();
      copied.mockRestore();
    }
    expect(await storage.getObject(key)).toEqual(bytes);
    expect(
      await db
        .select(datePreservingColumns(attachments))
        .from(attachments)
        .where(eq(attachments.id, id)),
    ).toEqual(before);
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
  });
});
