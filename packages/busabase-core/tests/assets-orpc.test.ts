import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { deleteAttachmentSafely } from "open-domains/attachments/logic";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { attachments, busabaseAssets } from "../src/db/schema";
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
const API = "http://busabase.test/api/v1";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

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

  const callOpenApi = async (method: string, routePath: string, body?: unknown) => {
    const handler = new OpenAPIHandler(busabaseRouter);
    const request = new Request(`${API}${routePath}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await handler.handle(request, { context: {} });
    if (!result.matched) {
      throw new Error(`no OpenAPI route matched ${method} ${routePath}`);
    }
    const payload = await result.response.json();
    if (result.response.status >= 400) {
      throw new Error(
        `${method} ${routePath} -> ${result.response.status}: ${JSON.stringify(payload)}`,
      );
    }
    return payload;
  };

  describe("content-addressed key + dedup", () => {
    it("hashes to a blobs/sha256 key and dedups same-scope re-uploads", async () => {
      const req1 = await client.assets.createUploadUrl({
        fileName: "logo.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      // Git/OCI-style content-addressed key: algorithm segment + 2-char fan-out.
      expect(req1.storageKey).toMatch(/^attachments\/blobs\/sha256\/aa\//);
      expect(req1.storageKey).toMatch(/\.png$/);
      expect(req1.duplicate).toBe(false);

      const conf1 = await client.assets.confirm({
        storageKey: req1.storageKey,
        fileName: "logo.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      expect(conf1.attachmentId).toBeTruthy();
      expect(conf1.assetId).toBeTruthy();

      // Request-time dedup: identical bytes in the same scope → skip the upload,
      // reuse the existing key + attachment id.
      const req2 = await client.assets.createUploadUrl({
        fileName: "logo-copy.png",
        mimeType: "image/png",
        sizeBytes: 1234,
        contentHash: HASH_A,
      });
      expect(req2.duplicate).toBe(true);
      expect(req2.attachmentId).toBe(conf1.attachmentId);
      expect(req2.assetId).toBeTruthy();
      expect(req2.assetId).not.toBe(conf1.assetId);
      expect(req2.storageKey).toBe(req1.storageKey);
    });

    it("confirm safety-net dedups a duplicate content hash to the same row", async () => {
      const req = await client.assets.createUploadUrl({
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      const c1 = await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      // A second confirm with a different storageKey but the same hash still
      // resolves to the first row (no duplicate registry entry).
      const c2 = await client.assets.confirm({
        storageKey: "attachments/elsewhere/x.png",
        fileName: "b.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: HASH_B,
      });
      expect(c2.attachmentId).toBe(c1.attachmentId);
      expect(c2.assetId).toBeTruthy();
      expect(c2.assetId).not.toBe(c1.assetId);
    });

    it("falls back to the legacy per-owner key when no hash is supplied", async () => {
      const req = await client.assets.createUploadUrl({
        fileName: "nohash.png",
        mimeType: "image/png",
        sizeBytes: 10,
      });
      expect(req.storageKey).not.toMatch(/blobs\/sha256/);
      expect(req.storageKey).toMatch(/^attachments\//);
      expect(req.duplicate).toBe(false);
    });

    it("dedups repeat uploads through the asset route only", async () => {
      const hash = `sha256:${"8".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "compat.png",
        mimeType: "image/png",
        sizeBytes: 18,
        contentHash: hash,
      });
      const confirmed = await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "compat.png",
        mimeType: "image/png",
        sizeBytes: 18,
        contentHash: hash,
      });
      expect(confirmed.assetId).toBeTruthy();
      const duplicate = await client.assets.createUploadUrl({
        fileName: "compat-copy.png",
        mimeType: "image/png",
        sizeBytes: 18,
        contentHash: hash,
      });
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.assetId).toBeTruthy();
      expect(duplicate.assetId).not.toBe(confirmed.assetId);
    });
  });

  describe("asset library (ensureAsset on confirm)", () => {
    it("surfaces each confirmed upload as a logical asset while attachments dedupe by content", async () => {
      const list = await client.assets.list();
      expect(list.map((a) => a.name)).toContain("logo.png");
      // Two uploads of HASH_A bytes reuse one Attachment but keep separate Asset identities.
      expect(list.filter((a) => a.contentHash === HASH_A).length).toBeGreaterThanOrEqual(2);
    });

    it("assets.get returns detail with an empty where-used list initially", async () => {
      const list = await client.assets.list();
      const asset = expectDefined(list.find((a) => a.contentHash === HASH_A));
      const detail = await client.assets.get({ assetId: asset.id });
      expect(detail.asset.id).toBe(asset.id);
      expect(detail.usages).toEqual([]);
    });

    it("updates AI-readable Asset metadata through the public OpenAPI route", async () => {
      const hash = `sha256:${"5".repeat(64)}`;
      const upload = await callOpenApi("POST", "/assets/upload-urls", {
        fileName: "ai-readable-brochure.pdf",
        mimeType: "application/pdf",
        sizeBytes: 72,
        contentHash: hash,
      });
      const confirmed = await callOpenApi("POST", "/assets/confirmations", {
        storageKey: upload.storageKey,
        fileName: "ai-readable-brochure.pdf",
        mimeType: "application/pdf",
        sizeBytes: 72,
        contentHash: hash,
      });

      const detail = await callOpenApi("PATCH", `/assets/${confirmed.assetId}/metadata`, {
        metadata: {
          summary: "AI-readable brochure summary",
          extractedText: "issuer: ACME\nproduct: Wealth Guide\n",
          tags: ["brochure", "insurance"],
        },
        mode: "replace",
      });

      expect(detail.asset.metadata).toMatchObject({
        summary: "AI-readable brochure summary",
        extractedText: "issuer: ACME\nproduct: Wealth Guide\n",
        tags: ["brochure", "insurance"],
      });
    });
  });

  describe("Where-Used (synced from Base record merges)", () => {
    it("records a usage when a record references the asset, and clears it on delete", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "assets-wu",
        name: "Where Used",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "cover", name: "Cover", type: "attachment" },
        ],
      });
      const asset = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === HASH_A),
      );

      const createCr = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: {
          title: "Post",
          cover: [
            {
              id: asset.id,
              assetId: asset.id,
              attachmentId: asset.attachmentId,
              url: asset.url,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              size: asset.size,
            },
          ],
        },
        message: "add cover",
        submittedBy: "agent",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestId: createCr.id, verdict: "approved" });
      const merged = await client.changeRequests.merge({ changeRequestId: createCr.id });
      const recordId = merged.record?.id;
      expect(recordId).toBeTruthy();

      const detail = await client.assets.get({ assetId: asset.id });
      const usage = detail.usages.find((u) => u.fieldSlug === "cover");
      expect(usage).toBeDefined();
      expect(usage?.nodeType).toBe("base");
      expect(usage?.nodeSlug).toBe("assets-wu");

      // Deleting the record clears its usage (replace/remove semantics).
      const deleteCr = await client.records.deleteChangeRequest({ recordId: recordId as string });
      await client.changeRequests.review({ changeRequestId: deleteCr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: deleteCr.id });

      const after = await client.assets.get({ assetId: asset.id });
      expect(after.usages.find((u) => u.nodeSlug === "assets-wu")).toBeUndefined();
    });

    it("indexes legacy attachmentId-only refs into Assets", async () => {
      const hashG = `sha256:${"9".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "legacy.png",
        mimeType: "image/png",
        sizeBytes: 12,
        contentHash: hashG,
      });
      await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "legacy.png",
        mimeType: "image/png",
        sizeBytes: 12,
        contentHash: hashG,
      });
      const asset = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashG),
      );

      const base = await client.bases.create({
        autoMerge: true,
        slug: "legacy-attachment-ref",
        name: "Legacy Attachment Ref",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "file", name: "File", type: "attachment" },
        ],
      });
      const cr = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: {
          title: "Legacy",
          file: [
            {
              attachmentId: asset.attachmentId,
              url: asset.url,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              size: asset.size,
            },
          ],
        },
        message: "legacy attachment id",
        submittedBy: "agent",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      const detail = await client.assets.get({ assetId: asset.id });
      expect(detail.usages.some((u) => u.nodeSlug === "legacy-attachment-ref")).toBe(true);
    });
  });

  describe("Where-Used (Doc body embeds)", () => {
    it("records a whole-node usage when a Doc body embeds an attachment's storageKey, and clears it when the image is removed", async () => {
      const hashD = `sha256:${"d".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 99,
        contentHash: hashD,
      });
      await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "diagram.png",
        mimeType: "image/png",
        sizeBytes: 99,
        contentHash: hashD,
      });
      const asset = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashD),
      );

      const doc = await client.docs.create({
        autoMerge: true,
        slug: "wu-doc",
        name: "WU Doc",
        body: "# start",
      });
      const cr = await client.docs.createChangeRequest({
        nodeId: doc.node.id,
        body: `# Spec\n\n![diagram](${asset.url})\n`,
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      const detail = await client.assets.get({ assetId: asset.id });
      const usage = detail.usages.find((u) => u.nodeType === "doc");
      expect(usage).toBeDefined();
      expect(usage?.nodeSlug).toBe("wu-doc");
      // Whole-node usage: no record / field.
      expect(usage?.recordId).toBeNull();
      expect(usage?.fieldSlug).toBeNull();

      // Removing the embed from the body and re-merging clears the usage —
      // syncDocAssetUsages replaces (not just adds to) the doc's whole-node rows.
      const removeCr = await client.docs.createChangeRequest({
        nodeId: doc.node.id,
        body: "# Spec\n\nNo more diagram here.\n",
      });
      await client.changeRequests.review({ changeRequestId: removeCr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: removeCr.id });

      const after = await client.assets.get({ assetId: asset.id });
      expect(after.usages.find((u) => u.nodeType === "doc")).toBeUndefined();
    });
  });

  describe("Where-Used (File nodes)", () => {
    it("creates first-class File nodes that reference Assets and appear in search", async () => {
      const hash = `sha256:${"7".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "board-plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 88,
        contentHash: hash,
        context: "file-node",
      });
      const confirmed = await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "board-plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 88,
        contentHash: hash,
        context: "file-node",
      });
      expect(confirmed.assetId).toBeTruthy();

      const cr = await client.nodes.createChangeRequest({
        operations: [
          {
            kind: "create",
            nodeType: "file",
            slug: "board-plan",
            name: "Board Plan",
            description: "Planning PDF for the board review",
            metadata: { assetId: confirmed.assetId },
          },
        ],
        autoMerge: false,
      });
      expect(cr.status).toBe("in_review");
      expect(cr.primaryOperation?.operation).toBe("node_create");
      await expect(client.files.get({ nodeId: "board-plan" })).rejects.toThrow(/File not found/);
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      const merged = await client.changeRequests.merge({ changeRequestId: cr.id });
      expect(merged.changeRequest.status).toBe("merged");

      const file = await client.files.get({ nodeId: "board-plan" });
      expect(file.node.type).toBe("file");
      expect(file.asset.id).toBe(confirmed.assetId);
      expect(file.asset.fileName).toBe("board-plan.pdf");

      const assetDetail = await client.assets.get({ assetId: confirmed.assetId as string });
      const usage = assetDetail.usages.find((item) => item.nodeType === "file");
      expect(usage).toBeDefined();
      expect(usage?.nodeSlug).toBe("board-plan");
      expect(usage?.fieldSlug).toBe("file:asset");

      const search = await client.search({ query: "board-plan.pdf", limit: 10 });
      expect(search.results.some((result) => result.href === "/file/board-plan")).toBe(true);
    });

    it("creates File nodes through the public OpenAPI Change Request route", async () => {
      const hash = `sha256:${"6".repeat(64)}`;
      const upload = await callOpenApi("POST", "/assets/upload-urls", {
        fileName: "openapi-board-plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 96,
        contentHash: hash,
        context: "file-node",
      });
      const confirmed = await callOpenApi("POST", "/assets/confirmations", {
        storageKey: upload.storageKey,
        fileName: "openapi-board-plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 96,
        contentHash: hash,
        context: "file-node",
      });

      const changeRequest = await callOpenApi("POST", "/nodes/change-requests", {
        message: "Create OpenAPI FileNode",
        operations: [
          {
            kind: "create",
            nodeType: "file",
            slug: "openapi-board-plan",
            name: "OpenAPI Board Plan",
            metadata: { assetId: confirmed.assetId },
          },
        ],
        autoMerge: false,
      });
      expect(changeRequest.status).toBe("in_review");
      await expect(callOpenApi("GET", "/files/openapi-board-plan")).rejects.toThrow(
        /File not found/,
      );
      await callOpenApi("POST", `/change-requests/${changeRequest.id}/reviews`, {
        verdict: "approved",
      });
      const merged = await callOpenApi("POST", `/change-requests/${changeRequest.id}/merge`);
      expect(merged.changeRequest.status).toBe("merged");

      const file = await callOpenApi("GET", "/files/openapi-board-plan");
      expect(file.node.type).toBe("file");
      expect(file.node.slug).toBe("openapi-board-plan");
      expect(file.asset.id).toBe(confirmed.assetId);
      expect(file.asset.fileName).toBe("openapi-board-plan.pdf");
    });
  });

  describe("assets.delete (refcount-guarded)", () => {
    it("deletes an unreferenced asset and removes it from the library", async () => {
      const hashE = `sha256:${"e".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "temp.png",
        mimeType: "image/png",
        sizeBytes: 7,
        contentHash: hashE,
      });
      await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "temp.png",
        mimeType: "image/png",
        sizeBytes: 7,
        contentHash: hashE,
      });
      const asset = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashE),
      );

      const res = await client.assets.delete({ assetId: asset.id });
      expect(res.deleted).toBe(true);
      expect((await client.assets.list()).some((a) => a.id === asset.id)).toBe(false);
    });

    it("refuses to delete an asset that is still referenced", async () => {
      const hashF = `sha256:${"f".repeat(64)}`;
      const req = await client.assets.createUploadUrl({
        fileName: "used.png",
        mimeType: "image/png",
        sizeBytes: 8,
        contentHash: hashF,
      });
      await client.assets.confirm({
        storageKey: req.storageKey,
        fileName: "used.png",
        mimeType: "image/png",
        sizeBytes: 8,
        contentHash: hashF,
      });
      const asset = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashF),
      );

      const base = await client.bases.create({
        autoMerge: true,
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
              id: asset.id,
              assetId: asset.id,
              attachmentId: asset.attachmentId,
              url: asset.url,
              fileName: asset.fileName,
              mimeType: asset.mimeType,
              size: asset.size,
            },
          ],
        },
        message: "add",
        submittedBy: "agent",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: cr.id });

      await expect(client.assets.delete({ assetId: asset.id })).rejects.toThrow(/still referenced/);
    });

    it("does not delete the Attachment while another Asset row still points at it", async () => {
      const db = await getDb();
      const hashG = `sha256:${"1".repeat(64)}`;
      const hashH = `sha256:${"2".repeat(64)}`;
      const reqA = await client.assets.createUploadUrl({
        fileName: "shared-a.png",
        mimeType: "image/png",
        sizeBytes: 9,
        contentHash: hashG,
      });
      await client.assets.confirm({
        storageKey: reqA.storageKey,
        fileName: "shared-a.png",
        mimeType: "image/png",
        sizeBytes: 9,
        contentHash: hashG,
      });
      const assetA = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashG),
      );
      const reqB = await client.assets.createUploadUrl({
        fileName: "shared-b.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: hashH,
      });
      await client.assets.confirm({
        storageKey: reqB.storageKey,
        fileName: "shared-b.png",
        mimeType: "image/png",
        sizeBytes: 10,
        contentHash: hashH,
      });
      const assetB = expectDefined(
        (await client.assets.list()).find((a) => a.contentHash === hashH),
      );

      // Simulate two logical Assets deduped onto the same physical Attachment
      // (e.g. a file-tree replace that repointed assetA's attachmentId onto
      // assetB's upload — see `upsertFileAssetAtPath`).
      await db
        .update(busabaseAssets)
        .set({ attachmentId: assetB.attachmentId })
        .where(eq(busabaseAssets.id, assetA.id));

      const res = await client.assets.delete({ assetId: assetB.id });
      expect(res.deleted).toBe(true);
      expect((await client.assets.list()).some((a) => a.id === assetB.id)).toBe(false);

      // assetA still resolves — its (shared) Attachment must not have been removed.
      const stillReadable = await client.assets.get({ assetId: assetA.id });
      expect(stillReadable.asset.attachmentId).toBe(assetB.attachmentId);
      const [attachmentRow] = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.id, assetB.attachmentId));
      expect(attachmentRow).toBeDefined();
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
