import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackup } from "./commands.js";
import { SourceDeletedAfterSnapshotError } from "./export/full-exporter.js";

type Row = Record<string, unknown>;
const notFound = (message: string) => Object.assign(new Error(message), { code: "NOT_FOUND" });
// Only downloads with a registered hash are reusable across snapshots.
const contentHash = (id: string) =>
  `sha256:${createHash("sha256").update(`bytes of /${id}`).digest("hex")}`;

describe("backup retakes the snapshot when a file is deleted mid-download", () => {
  let directory: string;
  let server: Server;
  let origin: string;
  const hits = new Map<string, number>();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-backup-retake-"));
    hits.clear();
    server = createServer((request, response) => {
      const path = request.url ?? "";
      hits.set(path, (hits.get(path) ?? 0) + 1);
      response.end(`bytes of ${path}`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    origin = `http://127.0.0.1:${address.port}`;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const attachmentRow = (id: string): Row => ({
    id,
    storageKey: `attachments/${id}.bin`,
    mimeType: "application/octet-stream",
    contentHash: contentHash(id),
  });
  const clientFor = (
    attachments: () => Row[],
    exportAttachment: (id: string) => Promise<unknown>,
  ): BusabaseClient =>
    ({
      dump: {
        exportTables: async ({ table }: { table: string }) => ({
          rows: table === "attachments" ? attachments() : [],
          nextCursor: null,
        }),
        exportDocBodies: async () => ({
          bodies: [],
          supportedRichNodeTypes: ["html", "whiteboard", "workflow"],
        }),
        exportAttachment: ({ attachmentId }: { attachmentId: string }) =>
          exportAttachment(attachmentId),
      },
      nodes: {},
    }) as unknown as BusabaseClient;
  const backup = (client: BusabaseClient) =>
    runBackup(client, {
      outFile: join(directory, "space.bbdump"),
      includeHistory: true,
      json: true,
      baseUrl: origin,
      spaceId: "source",
      retries: 0,
      toolVersion: "test",
    }) as Promise<{ manifest: { tables: Record<string, number>; blobCount: number } }>;
  const download = (id: string) => ({
    attachmentId: id,
    storageKey: `attachments/${id}.bin`,
    mimeType: "application/octet-stream",
    contentHash: contentHash(id),
    sizeBytes: Buffer.byteLength(`bytes of /${id}`),
    downloadUrl: `${origin}/${id}`,
  });

  it("publishes the next snapshot without the deleted file and keeps verified downloads", async () => {
    const deleted = new Set<string>();
    let snapshots = 0;
    const client = clientFor(
      () => {
        snapshots++;
        return ["att_a_keep", "att_b_gone"].filter((id) => !deleted.has(id)).map(attachmentRow);
      },
      async (id) => {
        if (id === "att_b_gone") {
          deleted.add(id);
          throw notFound("Attachment not found in this space");
        }
        return download(id);
      },
    );
    const result = await backup(client);
    expect(snapshots).toBe(2);
    expect(result.manifest.tables.attachments).toBe(1);
    expect(result.manifest.blobCount).toBe(1);
    // Downloaded once in the first round, reused from the verified cache after.
    expect(hits.get("/att_a_keep")).toBe(1);
    expect(hits.has("/att_b_gone")).toBe(false);
    expect(existsSync(join(directory, "space.bbdump"))).toBe(true);
  });

  it("gives up after the bounded retakes when deletions keep racing the download", async () => {
    let snapshots = 0;
    const client = clientFor(
      () => [attachmentRow(`att_gone_${++snapshots}`)],
      async () => {
        throw notFound("Attachment not found in this space");
      },
    );
    await expect(backup(client)).rejects.toBeInstanceOf(SourceDeletedAfterSnapshotError);
    expect(snapshots).toBe(4);
    expect(existsSync(join(directory, "space.bbdump"))).toBe(false);
  });

  it("does not retake the snapshot for other download failures", async () => {
    let snapshots = 0;
    const client = clientFor(
      () => {
        snapshots++;
        return [attachmentRow("att_denied")];
      },
      async () => {
        throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN", status: 403 });
      },
    );
    await expect(backup(client)).rejects.toThrow(/could not download attachment att_denied/);
    expect(snapshots).toBe(1);
  });
});
