import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyArchive } from "../format/archive-reader.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { exportFull } from "./full-exporter.js";

type Row = Record<string, unknown>;
const hash = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const clientFor = (
  tables: Record<string, Row[]>,
  dump: Record<string, unknown> = {},
  nodes: Record<string, unknown> = {},
): BusabaseClient =>
  ({
    dump: {
      exportTables: async ({ table }: { table: string }) => ({
        rows: tables[table] ?? [],
        nextCursor: null,
      }),
      exportDocBodies: async () => ({
        bodies: [],
        supportedRichNodeTypes: ["html", "whiteboard", "workflow"],
      }),
      ...dump,
    },
    nodes,
  }) as unknown as BusabaseClient;

describe("full backup publishes only complete snapshots", () => {
  let directory: string;
  let outPath: string;
  const servers: Server[] = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-strict-backup-"));
    outPath = join(directory, "space.bbdump");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.closeAllConnections();
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const options = (client: BusabaseClient) => ({
    client,
    outPath,
    spaceId: "source",
    sourceHost: "http://unused.invalid",
    includeHistory: true,
    toolVersion: "test",
    retries: 0,
  });
  const listening = async (onRequest: RequestListener) => {
    const server = createServer(onRequest);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    return `http://127.0.0.1:${address.port}`;
  };
  const noPublication = async () => {
    expect(existsSync(outPath)).toBe(false);
    expect(
      (await readdir(directory)).filter(
        (name) => name.includes(".writing-") || name.includes(".tables-"),
      ),
    ).toEqual([]);
  };
  it.each(["a/b", "a\\b", "a\0b", ".", ".."])(
    "rejects unsafe legacy node id %s even without a stored body",
    async (nodeId) => {
      const client = clientFor({ nodes: [{ id: nodeId, type: "base", parentId: null }] });
      await expect(exportFull(options(client))).rejects.toThrow(/unsafe or duplicate node id/);
      await noPublication();
    },
  );

  const attachment = {
    id: "att_body",
    storageKey: "attachments/original.bin",
    mimeType: "application/octet-stream",
  };

  it("fails on a real HTTP 404 and leaves no complete archive", async () => {
    let attempts = 0;
    const origin = await listening((_request, response) => {
      attempts++;
      response.writeHead(404);
      response.end("missing");
    });
    const client = clientFor(
      { attachments: [attachment] },
      {
        exportAttachment: async () => ({
          ...attachment,
          attachmentId: attachment.id,
          contentHash: null,
          sizeBytes: 10,
          downloadUrl: `${origin}/missing`,
        }),
      },
    );
    await expect(exportFull(options(client))).rejects.toThrow(
      /Full backup incomplete.*attachment att_body.*HTTP 404/,
    );
    expect(attempts).toBe(1);
    await noPublication();
  });

  it("exhausts network retries before failing, with no archive or still-running cache writes", async () => {
    let attempts = 0;
    const origin = await listening((request) => {
      attempts++;
      request.socket.destroy();
    });
    const client = clientFor(
      { attachments: [attachment] },
      {
        exportAttachment: async () => ({
          ...attachment,
          attachmentId: attachment.id,
          contentHash: null,
          sizeBytes: 10,
          downloadUrl: `${origin}/drop`,
        }),
      },
    );
    await expect(exportFull({ ...options(client), retries: 1 })).rejects.toThrow(
      /attachment att_body after retries.*fetch failed/,
    );
    expect(attempts).toBe(2);
    await noPublication();
  });

  it("drains other started downloads and retains their resumable receipts before returning failure", async () => {
    const slowKey = "attachments/slow.bin";
    let slowCompleted = false;
    const origin = await listening((request, response) => {
      if (request.url === "/missing") {
        response.writeHead(404);
        response.end();
        return;
      }
      setTimeout(() => {
        slowCompleted = true;
        response.end("complete resumable bytes");
      }, 50);
    });
    const client = clientFor(
      { attachments: [attachment, { ...attachment, id: "att_slow", storageKey: slowKey }] },
      {
        exportAttachment: async ({ attachmentId }: { attachmentId: string }) => ({
          ...attachment,
          attachmentId,
          storageKey: attachmentId === "att_slow" ? slowKey : attachment.storageKey,
          contentHash: null,
          sizeBytes: 0,
          downloadUrl: `${origin}/${attachmentId === "att_slow" ? "slow" : "missing"}`,
        }),
      },
    );
    await expect(exportFull(options(client))).rejects.toThrow(/attachment att_body.*HTTP 404/);
    expect(slowCompleted).toBe(true);
    const files = await readdir(`${outPath}.attachment-blobs.part`);
    const id = createHash("sha256").update(slowKey).digest("hex");
    expect(files).toContain(`${id}.json`);
    expect(files).toContain(`${id}.bin`);
    expect(files.some((file) => file.endsWith(".downloading"))).toBe(false);
    await noPublication();
  });

  it.each(
    [
      [
        { nodeId: "doc", markdown: "one" },
        { nodeId: "doc", markdown: "duplicate" },
      ],
      [{ nodeId: "other-space-doc", markdown: "not requested" }],
      [{ nodeId: "doc", markdown: undefined }],
      [],
    ].map((bodies) => ({ bodies })),
  )("rejects a malformed or incomplete Doc body set %j", async ({ bodies }) => {
    const client = clientFor(
      { nodes: [{ id: "doc", type: "doc", parentId: null }] },
      { exportDocBodies: async () => ({ bodies }) },
    );
    await expect(exportFull(options(client))).rejects.toThrow(/document coverage error/);
    await noPublication();
  });

  it.each([
    { nodes: [{ id: "child", type: "folder", parentId: "missing" }], reason: /missing parent/ },
    {
      nodes: [
        { id: "one", type: "folder", parentId: "two" },
        { id: "two", type: "folder", parentId: "one" },
      ],
      reason: /parent graph contains a cycle/,
    },
  ])(
    "rejects an unrestorable source node graph before content transfers",
    async ({ nodes, reason }) => {
      const read = vi.fn(async () => ({ bodies: [] }));
      await expect(
        exportFull(options(clientFor({ nodes }, { exportDocBodies: read }))),
      ).rejects.toThrow(reason);
      expect(read).not.toHaveBeenCalled();
      await noPublication();
    },
  );

  it("keeps a complete legacy fallback when every Doc and folder body is readable", async () => {
    const tables = {
      nodes: [
        { id: "root", type: "folder", parentId: null },
        { id: "doc", type: "doc", parentId: "root" },
      ],
    };
    const client = clientFor(
      tables,
      {
        exportDocBodies: async () => {
          throw new Error("Not found");
        },
      },
      {
        get: async ({ type }: { type: string }) =>
          type === "folder"
            ? { type: "folder", body: "", bodyFormat: "markdown" }
            : { type: "doc", body: "complete legacy document" },
      },
    );
    const manifest = await exportFull(options(client));
    expect(manifest.tables.nodes).toBe(2);
    expect(await verifyArchive(outPath)).toEqual(manifest);
  });

  it("fails on readme/rich read errors, but preserves normal absence on a capable server", async () => {
    const tables = {
      nodes: [
        { id: "folder", type: "folder", parentId: null },
        { id: "rich", type: "html", parentId: "folder" },
      ],
    };
    const failing = clientFor(tables, {
      exportDocBodies: async () => {
        throw new Error("storage read failed");
      },
    });
    await expect(exportFull(options(failing))).rejects.toThrow(
      /could not read folder readmes.*storage read failed/,
    );
    await noPublication();
    const missingCapability = clientFor(tables, { exportDocBodies: async () => ({ bodies: [] }) });
    await expect(exportFull(options(missingCapability))).rejects.toThrow(
      /server does not support complete HTML/,
    );
    await noPublication();
    const manifest = await exportFull(options(clientFor(tables)));
    expect(await verifyArchive(outPath)).toEqual(manifest);
  });

  it("fails when a present derived-text row has no byte URL or its HTTP download is missing", async () => {
    const origin = await listening((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    const text = {
      id: "text",
      assetId: "asset",
      status: "present",
      textStorageKey: "asset-texts/source.txt",
    };
    const tables = {
      attachments: [attachment],
      assets: [{ id: "asset", attachmentId: attachment.id }],
      assetTexts: [text],
    };
    const bytes = Buffer.from("attachment");
    const serve = await listening((_request, response) => response.end(bytes));
    const dump = {
      exportAttachment: async () => ({
        ...attachment,
        attachmentId: attachment.id,
        contentHash: hash(bytes),
        sizeBytes: bytes.length,
        downloadUrl: `${serve}/attachment`,
      }),
      exportAssetText: async () => ({
        downloadUrl: `${origin}/missing.txt`,
        textStorageKey: text.textStorageKey,
        textContentHash: null,
      }),
    };
    await expect(exportFull(options(clientFor(tables, dump)))).rejects.toThrow(
      /could not download text for asset asset.*HTTP 404/,
    );
    await noPublication();
    await expect(
      exportFull({
        ...options(
          clientFor(tables, {
            ...dump,
            exportAssetText: async () => ({
              downloadUrl: null,
              textStorageKey: text.textStorageKey,
            }),
          }),
        ),
        resume: true,
      }),
    ).rejects.toThrow(/no download URL for extracted text/);
    await noPublication();
  });

  it("retains every non-null hash for a shared key and rejects conflicting registrations", async () => {
    const expected = Buffer.from("source bytes");
    let attempts = 0;
    const origin = await listening((_request, response) => {
      attempts++;
      response.end("modified bytes");
    });
    const second = { ...attachment, id: "att_last_null", contentHash: null };
    const tables = {
      attachments: [{ ...attachment, contentHash: hash(expected).slice(7) }, second],
    };
    const dump = {
      exportAttachment: async () => ({
        ...second,
        attachmentId: second.id,
        sizeBytes: expected.length,
        downloadUrl: `${origin}/rewritten`,
      }),
    };
    await expect(exportFull(options(clientFor(tables, dump)))).rejects.toThrow(
      /Content hash mismatch/,
    );
    expect(attempts).toBe(1);
    await noPublication();
    const conflict = {
      attachments: [
        { ...attachment, contentHash: hash(expected) },
        { ...second, contentHash: hash(Buffer.from("different")) },
      ],
    };
    await expect(exportFull(options(clientFor(conflict, dump)))).rejects.toThrow(
      /Conflicting registered content hashes/,
    );
    expect(attempts).toBe(1);
    await noPublication();
  });

  it("keeps a previous verified archive across an archive read failure, then replaces it atomically on success", async () => {
    const previousManifest = await exportFull(options(clientFor({})));
    const previousBytes = await readFile(outPath);
    const bytes = Buffer.from("a complete replacement blob");
    let attempts = 0;
    const origin = await listening((_request, response) => {
      attempts++;
      response.end(bytes);
    });
    const client = clientFor(
      { attachments: [{ ...attachment, contentHash: hash(bytes) }] },
      {
        exportAttachment: async () => ({
          ...attachment,
          attachmentId: attachment.id,
          contentHash: hash(bytes),
          sizeBytes: bytes.length,
          downloadUrl: `${origin}/original`,
        }),
      },
    );
    const addStream = ArchiveWriter.prototype.addStream;
    const fail = vi.spyOn(ArchiveWriter.prototype, "addStream").mockImplementationOnce(function (
      this: ArchiveWriter,
      path,
      size,
      source,
    ) {
      source.destroy();
      const broken = new Readable({
        read() {
          this.destroy(new Error("forced archive source read failure"));
        },
      });
      return addStream.call(this, path, size, broken);
    });
    await expect(exportFull(options(client))).rejects.toThrow(/forced archive source read failure/);
    fail.mockRestore();
    expect((await readFile(outPath)).equals(previousBytes)).toBe(true);
    expect(await verifyArchive(outPath)).toEqual(previousManifest);
    expect(
      (await readdir(directory)).filter(
        (name) => name.includes(".writing-") || name.includes(".tables-"),
      ),
    ).toEqual([]);
    const replacement = await exportFull({ ...options(client), resume: true });
    expect(attempts).toBe(1); // A successful download survived the failed archive publication.
    expect(replacement.blobCount).toBe(1);
    expect(await verifyArchive(outPath)).toEqual(replacement);
    expect((await readFile(outPath)).equals(previousBytes)).toBe(false);
  });
});
