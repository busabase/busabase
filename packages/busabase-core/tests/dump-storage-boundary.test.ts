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
import { attachments, busabaseAssets, busabaseAssetTexts, busabaseNodes } from "../src/db/schema";
import { loadAssetTextRows } from "../src/domains/assets/logic/asset-texts-logic";
import { docBodyKey } from "../src/domains/doc/handlers";
import { datePreservingColumns } from "../src/domains/dump/logic/import-row-values";
import { folderReadmeKey } from "../src/domains/folder/handlers";
import { richNodeDocumentKey } from "../src/domains/rich-node/handlers";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";

const client = createRouterClient(busabaseRouter),
  body = Buffer.from("private bytes belonging to the other space");
const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId }, work);
describe("restore registration and node storage boundaries with real PGlite", () => {
  let cwd: string,
    dataDir: string,
    storageDir: string,
    sequence = 0;
  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-boundary-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-boundary-storage-"));
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
    const spaceId = `boundary-${++sequence}`;
    const begun = await inSpace(spaceId, () => client.dump.importBegin({ sourceSpaceId: spaceId }));
    return { spaceId, sessionId: begun.sessionId };
  };
  const registry = (id: string, spaceId: string, key: string) => ({
    id,
    spaceId,
    storageKey: key,
    userId: "owner",
    fileName: "file.txt",
    mimeType: "text/plain",
    sizeBytes: body.length,
    contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
  });

  it("rejects a new attachment id aliasing a foreign key while retaining legal same-space sharing", async () => {
    const { spaceId, sessionId } = await start(),
      db = await getDb(),
      key = `attachments/foreign-alias-${sequence}.txt`,
      foreignId = `att_foreign_alias_${sequence}`;
    await db.insert(attachments).values({
      ...registry(foreignId, "foreign-space", key),
      metadata: { private: "foreign registration" },
    });
    await storage.uploadFileToKey(body, key, "text/plain");
    const before = await db
      .select(datePreservingColumns(attachments))
      .from(attachments)
      .where(eq(attachments.id, foreignId));
    await expect(
      inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachments",
          rows: [registry(`att_new_alias_${sequence}`, spaceId, key)],
        }),
      ),
    ).rejects.toThrow(/another space/);
    expect(
      await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, `att_new_alias_${sequence}`)),
    ).toEqual([]);
    expect(await storage.getObject(key)).toEqual(body);
    expect(
      await db
        .select(datePreservingColumns(attachments))
        .from(attachments)
        .where(eq(attachments.id, foreignId)),
    ).toEqual(before);
    const ownKey = `attachments/own-alias-${sequence}.txt`;
    await db.insert(attachments).values(registry(`att_existing_own_${sequence}`, spaceId, ownKey));
    await storage.uploadFileToKey(body, ownKey, "text/plain");
    expect(
      await inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "attachments",
          rows: [registry(`att_legal_own_alias_${sequence}`, spaceId, ownKey)],
        }),
      ),
    ).toEqual({ inserted: 1 });
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    expect(await storage.getObject(key)).toEqual(body);
  });

  it("does not grant reserved, foreign derived-text, or wrong-attachment keys through raw text registrations", async () => {
    const { spaceId, sessionId } = await start(),
      db = await getDb(),
      ownKey = `attachments/own-text-${sequence}.txt`,
      assetId = `ast_text_boundary_${sequence}`;
    await db.insert(attachments).values(registry(`att_text_boundary_${sequence}`, spaceId, ownKey));
    await db.insert(busabaseAssets).values({
      id: assetId,
      spaceId,
      attachmentId: `att_text_boundary_${sequence}`,
      name: "Own asset",
    });
    const foreignKey = `asset-texts/foreign-boundary-${sequence}.txt`,
      otherOwnKey = `attachments/other-own-${sequence}.txt`,
      reservedKey = `busabase/nodes/private-${sequence}/doc/doc.md`;
    await db
      .insert(attachments)
      .values(registry(`att_other_own_${sequence}`, spaceId, otherOwnKey));
    await db.insert(busabaseAssets).values({
      id: `ast_foreign_text_${sequence}`,
      spaceId: "foreign-space",
      attachmentId: "missing-foreign-source",
      name: "Foreign asset",
    });
    await db.insert(busabaseAssetTexts).values({
      id: `atx_foreign_${sequence}`,
      spaceId: "foreign-space",
      assetId: `ast_foreign_text_${sequence}`,
      textStorageKey: foreignKey,
      writtenBy: "foreign-writer",
    });
    for (const key of [ownKey, foreignKey, otherOwnKey, reservedKey])
      await storage.uploadFileToKey(body, key, "text/plain");
    for (const [index, key] of [reservedKey, foreignKey, otherOwnKey].entries()) {
      const id = `atx_attack_${sequence}_${index}`;
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "assetTexts",
            rows: [
              {
                id,
                spaceId,
                assetId,
                textStorageKey: key,
                writtenBy: index === 2 ? "auto" : "writer",
              },
            ],
          }),
        ),
      ).rejects.toThrow();
      expect(
        await db.select().from(busabaseAssetTexts).where(eq(busabaseAssetTexts.id, id)),
      ).toEqual([]);
      expect(await storage.getObject(key)).toEqual(body);
    }
    await expect(inSpace(spaceId, () => client.dump.exportAssetText({ assetId }))).rejects.toThrow(
      /not found/i,
    );
    // An older already-persisted reserved pointer must not remain a signing
    // capability after the new import guard starts rejecting its creation.
    await db.insert(busabaseAssetTexts).values({
      id: `atx_legacy_bad_${sequence}`,
      spaceId,
      assetId,
      textStorageKey: reservedKey,
      writtenBy: "legacy",
    });
    await expect(inSpace(spaceId, () => client.dump.exportAssetText({ assetId }))).rejects.toThrow(
      /content key/,
    );
    await expect(loadAssetTextRows(db, [assetId])).rejects.toThrow(/content key/);
    const ownAliasAsset = `ast_legacy_self_${sequence}`;
    await db.insert(busabaseAssets).values({
      id: ownAliasAsset,
      spaceId,
      attachmentId: `att_text_boundary_${sequence}`,
      name: "Legacy self alias",
    });
    expect(
      await inSpace(spaceId, () =>
        client.dump.importTables({
          sessionId,
          table: "assetTexts",
          rows: [
            {
              id: `atx_legacy_self_${sequence}`,
              spaceId,
              assetId: ownAliasAsset,
              textStorageKey: ownKey,
              writtenBy: "legacy-import",
            },
          ],
        }),
      ),
    ).toEqual({ inserted: 1 });
    expect(
      (await inSpace(spaceId, () => client.dump.exportAssetText({ assetId: ownAliasAsset })))
        .downloadUrl,
    ).toBeNull();
    expect((await loadAssetTextRows(db, [ownAliasAsset])).get(ownAliasAsset)?.textStorageKey).toBe(
      ownKey,
    );
    await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
  });

  it.each(["doc", "folder", "html", "workflow", "whiteboard"] as const)(
    "blocks unsafe old and new %s node identities before any foreign body access",
    async (type) => {
      const { spaceId, sessionId } = await start(),
        db = await getDb(),
        foreignId = `node_foreign_${type}_${sequence}`,
        unsafe = `x/../${foreignId}`;
      await db.insert(busabaseNodes).values({
        id: foreignId,
        spaceId: "foreign-space",
        type,
        slug: foreignId,
        name: "Private node",
      });
      const key =
        type === "doc"
          ? docBodyKey(foreignId)
          : type === "folder"
            ? folderReadmeKey(foreignId)
            : richNodeDocumentKey(foreignId, type);
      await storage.uploadFileToKey(body, key, "text/plain");
      const before = await db
        .select(datePreservingColumns(busabaseNodes))
        .from(busabaseNodes)
        .where(eq(busabaseNodes.id, foreignId));
      const row = {
        id: unsafe,
        spaceId,
        parentId: rootNodeIdForSpace(spaceId),
        type,
        slug: `unsafe-${sequence}`,
        name: "Unsafe old row",
      };
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({ sessionId, table: "nodes", rows: [row] }),
        ),
      ).rejects.toThrow(/single safe segment/);
      expect(await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, unsafe))).toEqual([]);
      // Simulate a row created by an older server; the write and read paths must
      // both defend the key even though its tenant-scoped lookup succeeds.
      await db.insert(busabaseNodes).values(row);
      await expect(
        inSpace(spaceId, () =>
          client.dump.importTables({
            sessionId,
            table: "docBodies",
            rows: [
              {
                nodeId: unsafe,
                markdown: "must not replace private body",
                ...(type === "html" || type === "workflow" || type === "whiteboard"
                  ? { nodeType: type }
                  : {}),
              },
            ],
          }),
        ),
      ).rejects.toThrow(/single safe segment/);
      const reads = vi.spyOn(LocalStorage.prototype, "getObject");
      try {
        await inSpace(spaceId, () => client.nodes.get({ nodeId: unsafe })).catch(() => undefined);
        expect(reads.mock.calls.some(([value]) => value.includes(unsafe))).toBe(false);
      } finally {
        reads.mockRestore();
      }
      expect(await storage.getObject(key)).toEqual(body);
      expect(
        await db
          .select(datePreservingColumns(busabaseNodes))
          .from(busabaseNodes)
          .where(eq(busabaseNodes.id, foreignId)),
      ).toEqual(before);
      await inSpace(spaceId, () => client.dump.importAbort({ sessionId }));
    },
  );
});
