import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import { LocalStorage, resetStorage, storage } from "openlib/storage";
import { createDevAttachmentRoute } from "openlib/storage/dev-routes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import * as database from "../src/db";
import { attachments, busabaseAssets, busabaseAssetUsages, busabaseNodes } from "../src/db/schema";
import {
  ASSET_ATTACHMENT_BACKUP_URL_TTL_SECONDS,
  exportAssetAttachmentSnapshotDependency,
} from "../src/domains/dump/logic/asset-attachment-backup";
import { busabaseRouter } from "../src/router";
import { createExactDumpReplayFixture } from "./helpers/exact-dump-replay";

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("readable Asset attachment backup copies with real PGlite and HTTP storage", () => {
  const source = "attachment-copy-source";
  const foreign = "attachment-copy-foreign";
  const userId = "source-asset-author";
  const attachmentId = "att_backup_foreign_dependency";
  const assetId = "ast_backup_readable_dependency";
  const body = Buffer.from(
    "Original source bytes 中文 😀\r\n<html>mail@example.invalid</html>",
    "utf8",
  );
  const key = `attachments/backup-copy/${sha(body)}.html`;
  const ownCreatedAt = new Date("2023-03-04T05:06:07.123Z");
  const ownUpdatedAt = new Date("2024-04-05T06:07:08.456Z");
  const foreignCreatedAt = new Date("2001-01-02T03:04:05.000Z");
  const foreignUpdatedAt = new Date("2002-02-03T04:05:06.000Z");
  const privateSentinels = [
    "foreign-private-metadata",
    "foreign-registry-owner",
    "foreign-context",
  ];
  const client = createRouterClient(busabaseRouter);
  let cwd: string;
  let dataDir: string;
  let storageDir: string;
  let origin: string;
  let server: Server;
  let originalPublicBase: string | undefined;
  let foreignRow: unknown;

  const inSource = <T>(work: () => Promise<T>) =>
    runWithBusabaseContext({ spaceId: source, actorId: userId, isSpaceManager: true }, work);

  const requestCopy = (id = assetId, extra: Record<string, unknown> = {}, manager = true) =>
    fetch(`${origin}/api/v1/dump/export/asset-attachment`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-manager": String(manager) },
      body: JSON.stringify({ assetId: id, ...extra }),
    });

  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-copy-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-copy-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    originalPublicBase = process.env.STORAGE_PUBLIC_BASE_URL;
    delete process.env.STORAGE_PUBLIC_BASE_URL;
    const api = new OpenAPIHandler(busabaseRouter);
    const files = createDevAttachmentRoute({ gateProduction: false });
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", origin);
        let result: Response;
        if (url.pathname.startsWith("/files/")) {
          result = await files.GET(new Request(url), {
            params: Promise.resolve({
              key: url.pathname.slice(7).split("/").map(decodeURIComponent),
            }),
          });
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const handled = await runWithBusabaseContext(
            {
              spaceId: source,
              actorId: userId,
              isSpaceManager: request.headers["x-test-manager"] !== "false",
            },
            () =>
              api.handle(
                new Request(url, {
                  method: request.method,
                  headers: { "content-type": "application/json" },
                  body: Buffer.concat(chunks),
                }),
                { context: {} },
              ),
          );
          result = handled.matched ? handled.response : new Response("Not found", { status: 404 });
        }
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(500);
        response.end(error instanceof Error ? error.message : String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test HTTP origin");
    origin = `http://127.0.0.1:${address.port}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=${encodeURIComponent(`${origin}/files`)}`;
    resetStorage();
    await inSource(() => client.nodes.list({}));
    const db = await database.getDb();
    await db.insert(attachments).values(
      [
        { id: attachmentId, spaceId: foreign, storageKey: key },
        { id: "att_backup_own", spaceId: source, storageKey: "attachments/backup-copy/own.html" },
        { id: "att_backup_null", spaceId: null, storageKey: "attachments/backup-copy/null.html" },
        { id: "att_backup_unreferenced_foreign", spaceId: foreign, storageKey: key },
      ].map((row) => ({
        ...row,
        fileName: "source.html",
        mimeType: "text/html",
        sizeBytes: body.length,
        contentHash: `sha256:${sha(body)}`,
        userId: privateSentinels[1],
        context: privateSentinels[2],
        metadata: { private: privateSentinels[0] },
        createdAt: foreignCreatedAt,
        updatedAt: foreignUpdatedAt,
      })),
    );
    await db.insert(busabaseAssets).values(
      [
        { id: assetId, attachmentId, spaceId: source },
        { id: "ast_backup_snapshot_receipt", attachmentId, spaceId: source },
        { id: "ast_backup_precision_anchor", attachmentId, spaceId: source },
        { id: "ast_backup_hidden_dependency", attachmentId, spaceId: source },
        { id: "ast_backup_other_space", attachmentId, spaceId: foreign },
        { id: "ast_backup_own", attachmentId: "att_backup_own", spaceId: source },
        { id: "ast_backup_null", attachmentId: "att_backup_null", spaceId: source },
      ].map((row) => ({
        ...row,
        name: "Readable dependency",
        metadata: {},
        createdBy: userId,
        createdAt: ownCreatedAt,
        updatedAt: ownUpdatedAt,
      })),
    );
    // A manager still cannot derive Asset read access from a mount in another space.
    await db.insert(busabaseNodes).values({
      id: "node_backup_foreign_mount",
      spaceId: foreign,
      type: "doc",
      slug: "foreign-mount",
      name: "Foreign node",
    });
    await db.insert(busabaseAssetUsages).values({
      id: "usage_backup_hidden_dependency",
      spaceId: source,
      assetId: "ast_backup_hidden_dependency",
      nodeId: "node_backup_foreign_mount",
      ownerType: "doc",
    });
    for (const objectKey of [
      key,
      "attachments/backup-copy/own.html",
      "attachments/backup-copy/null.html",
    ])
      await storage.uploadFileToKey(body, objectKey, "text/html");
    foreignRow = plain(
      (await db.select().from(attachments).where(eq(attachments.id, attachmentId)))[0],
    );
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await database.closeDb();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalPublicBase === undefined) delete process.env.STORAGE_PUBLIC_BASE_URL;
    else process.env.STORAGE_PUBLIC_BASE_URL = originalPublicBase;
    process.chdir(cwd);
    for (const dir of [dataDir, storageDir]) await rm(dir, { recursive: true, force: true });
  });

  it("copies the already-readable bytes through HTTP without exporting foreign private columns", async () => {
    const normal = await inSource(() => client.assets.get({ assetId }));
    expect(normal.asset.attachmentId).toBe(attachmentId);
    const sign = vi.spyOn(LocalStorage.prototype, "generatePresignedUrl");
    const response = await requestCopy();
    expect(response.status).toBe(200);
    const copy = await response.json();
    expect(sign).toHaveBeenCalledWith(key, ASSET_ATTACHMENT_BACKUP_URL_TTL_SECONDS);
    expect(copy).toEqual({
      assetId,
      attachmentId,
      downloadUrl: `${origin}/files/${key}`,
      materializedAttachment: {
        id: attachmentId,
        spaceId: source,
        storageKey: key,
        fileName: "source.html",
        mimeType: "text/html",
        sizeBytes: body.length,
        contentHash: `sha256:${sha(body)}`,
        context: "busabase-backup-dependency",
        userId,
        metadata: {
          busabaseBackupDependency: {
            version: 1,
            sourceAssetId: assetId,
            sourceAttachmentId: attachmentId,
            sourceSpaceId: source,
            projection: "readable-asset-content",
            originalAttachmentOwnershipOmitted: true,
          },
        },
        createdAt: ownCreatedAt.toISOString().replace("Z", "000Z"),
        updatedAt: ownUpdatedAt.toISOString().replace("Z", "000Z"),
      },
    });
    const encoded = JSON.stringify(copy);
    for (const privateValue of [
      ...privateSentinels,
      foreignCreatedAt.toISOString(),
      foreignUpdatedAt.toISOString(),
    ])
      expect(encoded).not.toContain(privateValue);
    const downloaded = await fetch(copy.downloadUrl);
    expect(downloaded.status).toBe(200);
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    expect(bytes).toEqual(body);
    expect(sha(bytes)).toBe(sha(body));
    sign.mockRestore();
  });

  it("keeps raw foreign attachment reads refused and does not repair or alter the source", async () => {
    await expect(inSource(() => client.dump.exportAttachment({ attachmentId }))).rejects.toThrow(
      /not found/i,
    );
    const raw = await inSource(() =>
      client.dump.exportTables({ table: "attachments", limit: 500 }),
    );
    expect(raw.rows.some((row) => row.id === attachmentId)).toBe(false);
    const db = await database.getDb();
    expect(
      plain((await db.select().from(attachments).where(eq(attachments.id, attachmentId)))[0]),
    ).toEqual(foreignRow);
    const [asset] = await db.select().from(busabaseAssets).where(eq(busabaseAssets.id, assetId));
    expect(asset.attachmentId).toBe(attachmentId);
    expect(asset.metadata).toEqual({});
  });

  it("does not accept an attachment id, another space's Asset, or caller-supplied replacement fields", async () => {
    for (const id of [attachmentId, "ast_backup_other_space", "ast_backup_missing"])
      expect((await requestCopy(id)).status).toBe(404);
    const response = await requestCopy(assetId, {
      attachmentId: "att_backup_unreferenced_foreign",
      storageKey: "attachments/unrequested-private-key",
      materializedAttachment: { metadata: { injected: true } },
    });
    expect(response.status).toBe(400);
  });

  it("requires both space-manager backup authority and the normal Asset read ACL", async () => {
    await expect(
      runWithBusabaseContext({ spaceId: source, actorId: userId, isSpaceManager: false }, () =>
        client.assets.get({ assetId }),
      ),
    ).resolves.toBeDefined();
    expect((await requestCopy(assetId, {}, false)).status).toBe(403);
    await expect(
      inSource(() => client.assets.get({ assetId: "ast_backup_hidden_dependency" })),
    ).rejects.toThrow(/not found/i);
    expect((await requestCopy("ast_backup_hidden_dependency")).status).toBe(404);
  });

  it("retains original raw registrations for owned and null-space attachments", async () => {
    for (const id of ["ast_backup_own", "ast_backup_null"])
      expect((await requestCopy(id)).status).toBe(404);
    const raw = await inSource(() =>
      client.dump.exportTables({ table: "attachments", limit: 500 }),
    );
    expect(raw.rows.map((row) => row.id)).toEqual(
      expect.arrayContaining(["att_backup_own", "att_backup_null"]),
    );
  });

  it("captures inside the supplied read-only transaction without a singleton DB lookup or nested transaction", async () => {
    const db = await database.getDb();
    const receipt = await inSource(() =>
      db.transaction(async (transaction) => {
        await transaction.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
        const [anchor] = await transaction
          .select()
          .from(busabaseAssets)
          .where(and(eq(busabaseAssets.id, assetId), eq(busabaseAssets.spaceId, source)));
        const lookup = vi
          .spyOn(database, "getDb")
          .mockRejectedValue(new Error("Unexpected singleton lookup inside snapshot"));
        try {
          return await exportAssetAttachmentSnapshotDependency(transaction, anchor);
        } finally {
          lookup.mockRestore();
        }
      }),
    );
    expect(receipt.assetId).toBe(assetId);
    expect(receipt.materializedAttachment.createdAt).toBe(ownCreatedAt.toISOString());
  });

  it("binds the snapshot anchor to its actual attachment instead of trusting a mismatched internal row", async () => {
    const db = await database.getDb();
    const [anchor] = await db.select().from(busabaseAssets).where(eq(busabaseAssets.id, assetId));
    await expect(
      inSource(() =>
        exportAssetAttachmentSnapshotDependency(db, {
          ...anchor,
          attachmentId: "att_backup_unreferenced_foreign",
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("keeps six-digit source Asset timestamps in both snapshot receipts and the endpoint", async () => {
    const db = await database.getDb();
    const createdAt = "2023-03-04T05:06:07.123456Z";
    const updatedAt = "2024-04-05T06:07:08.456789Z";
    await db.execute(sql`
      UPDATE ${busabaseAssets}
      SET created_at = ${createdAt}::timestamp, updated_at = ${updatedAt}::timestamp
      WHERE id = 'ast_backup_precision_anchor'
    `);
    const [anchor] = await db
      .select({
        id: busabaseAssets.id,
        attachmentId: busabaseAssets.attachmentId,
        spaceId: busabaseAssets.spaceId,
        createdBy: busabaseAssets.createdBy,
        createdAt: sql<string>`to_char(${busabaseAssets.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        updatedAt: sql<string>`to_char(${busabaseAssets.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, "ast_backup_precision_anchor"));
    const receipt = await inSource(() => exportAssetAttachmentSnapshotDependency(db, anchor));
    expect(receipt.materializedAttachment).toMatchObject({ createdAt, updatedAt });
    const response = await requestCopy("ast_backup_precision_anchor");
    expect(response.status).toBe(200);
    expect((await response.json()).materializedAttachment).toMatchObject({ createdAt, updatedAt });
  });

  it("retains its captured receipt when the source Asset is deleted after the snapshot", async () => {
    const response = await requestCopy("ast_backup_snapshot_receipt");
    expect(response.status).toBe(200);
    const receipt = await response.json();
    const db = await database.getDb();
    await db.delete(busabaseAssets).where(eq(busabaseAssets.id, "ast_backup_snapshot_receipt"));
    expect((await requestCopy("ast_backup_snapshot_receipt")).status).toBe(404);
    const bytes = Buffer.from(await (await fetch(receipt.downloadUrl)).arrayBuffer());
    expect(bytes).toEqual(body);
    expect(receipt.materializedAttachment.updatedAt).toBe(
      ownUpdatedAt.toISOString().replace("Z", "000Z"),
    );
  });

  it("still rejects foreign target ids and shared keys without altering them during rollback", async () => {
    const response = await requestCopy();
    expect(response.status).toBe(200);
    const { materializedAttachment } = await response.json();
    for (const mode of ["foreign-id", "foreign-key", "resume-foreign-id"] as const) {
      const target = `attachment-copy-target-${mode}`;
      await runWithBusabaseContext({ spaceId: target }, async () => {
        await client.nodes.list({});
        if (mode === "resume-foreign-id") {
          const archive = createExactDumpReplayFixture({
            sourceSpaceId: source,
            rows: { attachments: [materializedAttachment] },
          });
          await archive.begin(client);
          const resumed = await archive.begin(client, { resume: true });
          try {
            await expect(archive.preflight(client, resumed.sessionId)).rejects.toMatchObject({
              code: "FORBIDDEN",
            });
          } finally {
            await client.dump.importAbort({ sessionId: resumed.sessionId });
          }
          return;
        }
        const { sessionId } = await client.dump.importBegin({
          sourceSpaceId: source,
        });
        try {
          await expect(
            client.dump.importTables({
              sessionId,
              table: mode === "foreign-key" ? "attachmentBlobs" : "attachments",
              rows:
                mode === "foreign-key"
                  ? [
                      {
                        storageKey: key,
                        base64: Buffer.from("must not overwrite").toString("base64"),
                      },
                    ]
                  : [materializedAttachment],
            }),
          ).rejects.toThrow();
        } finally {
          await client.dump.importAbort({ sessionId });
        }
      });
      const db = await database.getDb();
      expect(
        plain((await db.select().from(attachments).where(eq(attachments.id, attachmentId)))[0]),
      ).toEqual(foreignRow);
      expect(await storage.getObject(key)).toEqual(body);
      expect(await db.select().from(attachments).where(eq(attachments.spaceId, target))).toEqual(
        [],
      );
    }
  });
});
