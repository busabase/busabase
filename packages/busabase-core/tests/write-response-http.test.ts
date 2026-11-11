import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBusabaseOpenApiHandler } from "../src/openapi/handler";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const client = createRouterClient(busabaseRouter);
const handler = createBusabaseOpenApiHandler(busabaseRouter);

describe("write responses over HTTP describe the persisted result", () => {
  let server: Server;
  let origin = "";
  let baseId = "";
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let recordId = "";
  let headCommitId = "";
  const originalAttachments = Array.from({ length: 21 }, (_, index) => ({
    id: `legacy-video-${index}`,
    url: `https://files.example.test/video-${index}.mp4`,
    fileName: `video-${index}.mp4`,
    mimeType: "video/mp4",
    size: 1024,
  }));

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-write-http-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-write-http-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const base = await client.bases.create({
      slug: "write-response-http",
      name: "Write Response HTTP",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "note", name: "Note", type: "text" },
        { slug: "sequence", name: "Sequence", type: "auto_number" },
        { slug: "attachments", name: "Attachments", type: "attachment" },
      ],
    });
    baseId = base.id;
    await confirmAttachments(originalAttachments);
    server = createServer(async (incoming, outgoing) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const request = new Request(new URL(incoming.url ?? "/", origin), {
          method: incoming.method,
          headers: incoming.headers as HeadersInit,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const result = await handler.handle(request, { context: {} });
        if (!result.matched) {
          outgoing.writeHead(404).end();
          return;
        }
        outgoing.writeHead(
          result.response.status,
          Object.fromEntries(result.response.headers.entries()),
        );
        outgoing.end(Buffer.from(await result.response.arrayBuffer()));
      } catch (error) {
        outgoing.writeHead(500).end(String(error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP server port");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const post = (route: string, body: unknown) =>
    fetch(`${origin}/api/v1${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const confirmAttachments = async (refs: typeof originalAttachments) => {
    for (const ref of refs) {
      const input = { fileName: ref.fileName, mimeType: ref.mimeType, sizeBytes: ref.size };
      const upload = await client.assets.createUploadUrl(input);
      await storage.uploadFileToKey(Buffer.alloc(ref.size), upload.storageKey, ref.mimeType);
      const confirmed = await client.assets.confirm({ ...input, storageKey: upload.storageKey });
      ref.id = confirmed.attachmentId;
      ref.url = upload.publicUrl;
    }
  };

  it("returns generated values and a committed version when creating a record", async () => {
    const response = await post(`/bases/${baseId}/change-requests`, {
      fields: { title: "Delivery", note: "Keep this note", attachments: originalAttachments },
      idempotencyKey: "write-response-http:create",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      materialized: true,
      baseId,
      status: "active",
      headCommit: {
        payload: {
          title: "Delivery",
          note: "Keep this note",
          sequence: 1,
          attachments: originalAttachments,
        },
      },
    });
    expect(result.headCommitId).toBe(result.headCommit.id);
    recordId = result.id;
    headCommitId = result.headCommitId;
    // This read is a test's independent persistence assertion, not an Agent step.
    expect(await client.records.get({ recordId })).toMatchObject({
      headCommitId,
      headCommit: result.headCommit,
    });
  });

  it("returns all preserved attachment references and untouched fields after an append", async () => {
    const added = [
      {
        id: "legacy-new-video",
        url: "https://files.example.test/new.mp4",
        fileName: "new.mp4",
        mimeType: "video/mp4",
        size: 2048,
      },
      {
        id: "legacy-new-subtitles",
        url: "https://files.example.test/new.srt",
        fileName: "new.srt",
        mimeType: "application/x-subrip",
        size: 128,
      },
    ];
    await confirmAttachments(added);
    const attachments = [...originalAttachments, ...added];
    const response = await post(`/records/${recordId}/change-requests`, {
      operation: "update",
      baseCommitId: headCommitId,
      fields: { attachments },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      id: recordId,
      materialized: true,
      headCommit: { payload: { title: "Delivery", note: "Keep this note", attachments } },
    });
    expect(result.headCommitId).not.toBe(headCommitId);
    const stored = await client.records.get({ recordId });
    expect(stored).toMatchObject({
      headCommitId: result.headCommitId,
      headCommit: result.headCommit,
    });
  });

  it("reports a pending proposal without claiming the record changed", async () => {
    const response = await post(`/records/${recordId}/change-requests`, {
      operation: "update",
      fields: { title: "Proposed title" },
      autoMerge: false,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      materialized: false,
      status: "in_review",
      mergedAt: null,
      operationCount: 1,
    });
    expect(result.id).not.toBe(recordId);
    expect((await client.records.get({ recordId }))?.headCommit.payload.title).toBe("Delivery");
  });

  it("returns a merged CR receipt for bulk writes without returning every record", async () => {
    const response = await post(`/bases/${baseId}/records/bulk-update-change-request`, {
      updates: [{ recordId, fields: { note: "Bulk update" } }],
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "merged",
      operationCount: 1,
      mergeSummary: { operationCount: 1, recordIds: [recordId] },
    });
    expect(result.mergedAt).toEqual(expect.any(String));
    expect((await client.records.get({ recordId }))?.headCommit.payload.note).toBe("Bulk update");
  });

  it("returns an already merged CR on an idempotent retry even when materialized is false", async () => {
    const response = await post(`/bases/${baseId}/change-requests`, {
      fields: { title: "Delivery", note: "Keep this note", attachments: originalAttachments },
      idempotencyKey: "write-response-http:create",
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      materialized: false,
      status: "merged",
      operationCount: 1,
      mergeSummary: { recordIds: [recordId] },
    });
    expect(result.mergedAt).toEqual(expect.any(String));
    expect(await client.records.count({ baseId })).toMatchObject({ total: 1 });
    expect((await client.records.get({ recordId }))?.headCommit.payload.note).toBe("Bulk update");
  });
});
