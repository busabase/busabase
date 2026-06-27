import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { deleteAttachmentSafely } from "open-domains/attachments/logic";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { attachments } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

/**
 * Integration coverage for the Asset library + attachment content-hash dedup,
 * driven through the real oRPC router (`createRouterClient(busabaseRouter)`) so the
 * tests exercise the exact request → confirm → merge code paths a caller hits.
 *
 * Covers: content-addressed storage keys, request-time + confirm-time dedup, the
 * legacy-key fallback, `ensureAsset` surfacing uploads in the library, the
 * Where-Used reverse index synced from Base record merges, and the refcount-safe
 * `deleteAttachmentSafely`. PGlite migrations resolve from the reference app.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

describe("Assets + attachment dedup — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-assets-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-assets-storage-"));
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

  describe("content-addressed key + dedup", () => {
    it("hashes to a blobs/sha256 key and dedups same-scope re-uploads", async () => {
      const req1 = await client.attachments.createUploadUrl({
        fileName: "logo.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      // Git/OCI-style content-addressed key: algorithm segment + 2-char fan-out.
      expect(req1.storageKey).toMatch(/^attachments\/blobs\/sha256\/aa\//);
      expect(req1.storageKey).toMatch(/\.png$/);
      expect(req1.duplicate).toBe(false);

      const conf1 = await client.attachments.confirm({
        storageKey: req1.storageKey,
        fileName: "logo.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      expect(conf1.attachmentId).toBeTruthy();

      // Request-time dedup: identical bytes in the same scope → skip the upload,
      // reuse the existing key + attachment id.
      const req2 = await client.attachments.createUploadUrl({
        fileName: "logo-copy.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      expect(req2.duplicate).toBe(true);
      expect(req2.attachmentId).toBe(conf1.attachmentId);
      expect(req2.storageKey).toBe(req1.storageKey);
    });

    it("confirm safety-net dedups a duplicate content hash to the same row", async () => {
      const req = await client.attachments.createUploadUrl({
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      const c1 = await client.attachments.confirm({
        storageKey: req.storageKey,
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      // A second confirm with a different storageKey but the same hash still
      // resolves to the first row (no duplicate registry entry).
      const c2 = await client.attachments.confirm({
        storageKey: "attachments/elsewhere/x.png",
        fileName: "b.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      expect(c2.attachmentId).toBe(c1.attachmentId);
    });

    it("falls back to the legacy per-owner key when no hash is supplied", async () => {
      const req = await client.attachments.createUploadUrl({
        fileName: "nohash.png",
        mimeType: "image/png",
        sizeBytes: 10,
      });
      expect(req.storageKey).not.toMatch(/blobs\/sha256/);
      expect(req.storageKey).toMatch(/^attachments\//);
      expect(req.duplicate).toBe(false);
    });
  });

  describe("asset library (ensureAsset on confirm)", () => {
    it("surfaces each confirmed upload as exactly one asset, deduped by content", async () => {
      const list = await client.assets.list();
      expect(list.map((a) => a.name)).toContain("logo.png");
      // Two "uploads" of HASH_A bytes → still ONE asset (ensureAsset idempotent).
      expect(list.filter((a) => a.contentHash === HASH_A)).toHaveLength(1);
    });

    it("assets.get returns detail with an empty where-used list initially", async () => {
      const list = await client.assets.list();
      const asset = list.find((a) => a.contentHash === HASH_A);
      expect(asset).toBeDefined();
      const detail = await client.assets.get({ assetId: asset!.id });
      expect(detail.asset.id).toBe(asset!.id);
      expect(detail.usages).toEqual([]);
    });
  });

  describe("Where-Used (synced from Base record merges)", () => {
    it("records a usage when a record references the asset, and clears it on delete", async () => {
      const base = await client.bases.create({
        slug: "assets-wu",
        name: "Where Used",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "cover", name: "Cover", type: "attachment" },
        ],
      });
      const asset = (await client.assets.list()).find((a) => a.contentHash === HASH_A);
      expect(asset).toBeDefined();

      const createCr = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: {
          title: "Post",
          cover: [
            {
              id: asset!.attachmentId,
              url: asset!.url,
              fileName: asset!.fileName,
              mimeType: asset!.mimeType,
              size: asset!.size,
            },
          ],
        },
        message: "add cover",
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestId: createCr.id, verdict: "approved" });
      const merged = await client.changeRequests.merge({ changeRequestId: createCr.id });
      const recordId = merged.record?.id;
      expect(recordId).toBeTruthy();

      const detail = await client.assets.get({ assetId: asset!.id });
      const usage = detail.usages.find((u) => u.fieldSlug === "cover");
      expect(usage).toBeDefined();
      expect(usage?.nodeType).toBe("base");
      expect(usage?.nodeSlug).toBe("assets-wu");

      // Deleting the record clears its usage (replace/remove semantics).
      const deleteCr = await client.records.deleteChangeRequest({ recordId: recordId as string });
      await client.changeRequests.review({ changeRequestId: deleteCr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: deleteCr.id });

      const after = await client.assets.get({ assetId: asset!.id });
      expect(after.usages.find((u) => u.nodeSlug === "assets-wu")).toBeUndefined();
    });
  });

  describe("Where-Used (Doc body embeds)", () => {
    it("records a whole-node usage when a Doc body embeds an attachment's storageKey", async () => {
      const hashD = `sha256:${"d".repeat(64)}`;
      const req = await client.attachments.createUploadUrl({
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 99,
        contentHash: hashD,
      });
      await client.attachments.confirm({
        storageKey: req.storageKey,
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 99,
        contentHash: hashD,
      });
      const asset = (await client.assets.list()).find((a) => a.contentHash === hashD);
      expect(asset).toBeDefined();

      const doc = await client.docs.create({ slug: "wu-doc", name: "WU Doc", body: "# start" });
      const cr = await client.docs.createChangeRequest({
        nodeId: doc.node.id,
        body: `# Spec\n\n![diagram](${asset!.url})\n`,
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      const detail = await client.assets.get({ assetId: asset!.id });
      const usage = detail.usages.find((u) => u.nodeType === "doc");
      expect(usage).toBeDefined();
      expect(usage?.nodeSlug).toBe("wu-doc");
      // Whole-node usage: no record / field.
      expect(usage?.recordId).toBeNull();
      expect(usage?.fieldSlug).toBeNull();
    });
  });

  describe("assets.delete (refcount-guarded)", () => {
    it("deletes an unreferenced asset and removes it from the library", async () => {
      const hashE = `sha256:${"e".repeat(64)}`;
      const req = await client.attachments.createUploadUrl({
        fileName: "temp.png",
        mimeType: "image/png",
        sizeBytes: 7,
        contentHash: hashE,
      });
      await client.attachments.confirm({
        storageKey: req.storageKey,
        fileName: "temp.png",
        mimeType: "image/png",
        sizeBytes: 7,
        contentHash: hashE,
      });
      const asset = (await client.assets.list()).find((a) => a.contentHash === hashE);
      expect(asset).toBeDefined();

      const res = await client.assets.delete({ assetId: asset!.id });
      expect(res.deleted).toBe(true);
      expect((await client.assets.list()).some((a) => a.id === asset!.id)).toBe(false);
    });

    it("refuses to delete an asset that is still referenced", async () => {
      const hashF = `sha256:${"f".repeat(64)}`;
      const req = await client.attachments.createUploadUrl({
        fileName: "used.png",
        mimeType: "image/png",
        sizeBytes: 8,
        contentHash: hashF,
      });
      await client.attachments.confirm({
        storageKey: req.storageKey,
        fileName: "used.png",
        mimeType: "image/png",
        sizeBytes: 8,
        contentHash: hashF,
      });
      const asset = (await client.assets.list()).find((a) => a.contentHash === hashF);
      expect(asset).toBeDefined();

      const base = await client.bases.create({
        slug: "del-guard",
        name: "Delete Guard",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "img", name: "Img", type: "attachment" },
        ],
      });
      const cr = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: {
          title: "x",
          img: [
            {
              id: asset!.attachmentId,
              url: asset!.url,
              fileName: asset!.fileName,
              mimeType: asset!.mimeType,
              size: asset!.size,
            },
          ],
        },
        message: "add",
        submittedBy: "agent",
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      await expect(client.assets.delete({ assetId: asset!.id })).rejects.toThrow(
        /still referenced/,
      );
    });
  });

  describe("deleteAttachmentSafely (refcount by storageKey)", () => {
    it("keeps the shared object until the last referencing row is gone", async () => {
      const db = await getDb();
      const sharedKey = `attachments/blobs/sha256/cc/${"c".repeat(64)}.png`;
      await storage.uploadFileToKey(Buffer.from("bytes"), sharedKey, "image/png");
      // Two registry rows share one physical key (the cross-space dedup shape).
      await db.insert(attachments).values([
        {
          storageKey: sharedKey,
          fileName: "x.png",
          mimeType: "image/png",
          sizeBytes: 5,
          userId: "local",
        },
        {
          storageKey: sharedKey,
          fileName: "y.png",
          mimeType: "image/png",
          sizeBytes: 5,
          userId: "local",
        },
      ]);
      const rows = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.storageKey, sharedKey));
      expect(rows).toHaveLength(2);

      const first = await deleteAttachmentSafely(rows[0].id, db, attachments);
      expect(first).toEqual({ deletedRow: true, deletedObject: false });
      await expect(storage.getObject(sharedKey)).resolves.toBeInstanceOf(Buffer);

      const second = await deleteAttachmentSafely(rows[1].id, db, attachments);
      expect(second).toEqual({ deletedRow: true, deletedObject: true });
      await expect(storage.getObject(sharedKey)).rejects.toThrow();
    });
  });
});
