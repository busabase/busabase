import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { BusabaseClient } from "busabase-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainEntry, streamArchive, verifyArchive } from "../format/archive-reader.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { FORMAT_VERSION } from "../format/manifest.js";
import { importFull, sendRestoreBlobRows, streamNdjsonRows } from "./full-importer.js";

describe("streamNdjsonRows — multi-byte UTF-8 across chunk boundaries", () => {
  it("rejects invalid UTF-8 before a row can be sent with replacement characters", async () => {
    const send = vi.fn(async () => {});
    const body = Readable.from([
      Buffer.from('{"id":"row","text":"'),
      Buffer.from([0xe5, 0xad]),
      Buffer.from('"}\n'),
    ]);
    await expect(streamNdjsonRows(body, send)).rejects.toThrow(/encoded data|UTF-8/);
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves long CJK JSON through a real tar entry across every buffer boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "busabase-tar-utf8-"));
    try {
      const path = join(directory, "unicode.bbdump");
      const row = { id: "session", text: "多字节正文\r\n".repeat(20000), replacement: "�" };
      const writer = ArchiveWriter.create(path);
      await writer.addBuffer("padding.bin", Buffer.alloc(103));
      await writer.addBuffer("tree/agentSessions.ndjson", `${JSON.stringify(row)}\n`);
      await writer.finalize({
        formatVersion: FORMAT_VERSION,
        toolVersion: "test",
        exportedAt: new Date().toISOString(),
        spaceId: "source",
        sourceHost: "http://localhost",
        fidelity: "full",
        excludesSecrets: true,
        tables: { agentSessions: 1 },
        blobCount: 0,
        blobBytes: 0,
        textBlobCount: 0,
        textBlobBytes: 0,
      });
      const received: Array<Record<string, unknown>> = [];
      await streamArchive(path, async (entry) => {
        if (entry.path === "tree/agentSessions.ndjson")
          await streamNdjsonRows(entry.body, async (rows) => {
            received.push(...rows);
          });
        else await drainEntry(entry.body);
      });
      expect(received).toEqual([row]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("correctly decodes a CJK character whose UTF-8 bytes are split across two stream chunks", async () => {
    // "你" is E4 BD A0 in UTF-8 (3 bytes) — split the underlying tar-stream
    // entry mid-character to reproduce what a real decompress+detar pipeline
    // does for arbitrary byte offsets. Without `body.setEncoding("utf8")` in
    // `streamNdjsonRows`, `readline` decodes each raw Buffer chunk with its
    // own naive `toString()`, mangling this into invalid JSON — reproduced
    // live restoring a real production space with Chinese commit messages
    // (`Unterminated string in JSON`), at an unpredictable row depending on
    // where the compression stream happened to split a chunk.
    const line = `${JSON.stringify({ id: "row_1", message: "你好，世界" })}\n`;
    const lineBytes = Buffer.from(line, "utf8");

    // Find a split point that lands strictly inside a multi-byte sequence
    // (a continuation byte, 0x80–0xBF) rather than on a character boundary.
    let splitAt = -1;
    for (let i = 1; i < lineBytes.length; i += 1) {
      if ((lineBytes[i] & 0xc0) === 0x80) {
        splitAt = i;
        break;
      }
    }
    expect(splitAt).toBeGreaterThan(0); // sanity: the fixture does contain multi-byte chars

    const chunk1 = lineBytes.subarray(0, splitAt);
    const chunk2 = lineBytes.subarray(splitAt);
    const body = Readable.from([chunk1, chunk2]);

    const sent: Array<Array<Record<string, unknown>>> = [];
    const count = await streamNdjsonRows(body, async (rows) => {
      sent.push(rows);
    });

    expect(count).toBe(1);
    expect(sent).toEqual([[{ id: "row_1", message: "你好，世界" }]]);
  });
});

it("parses a long single row from thousands of chunks without repeatedly copying its prefix", async () => {
  const size = 16 * 1024 * 1024;
  const line = `${JSON.stringify({ id: "large-row", content: "x".repeat(size) })}\n`;
  const chunks = function* () {
    for (let offset = 0; offset < line.length; offset += 1024)
      yield Buffer.from(line.slice(offset, offset + 1024));
  };
  let received = 0;
  const count = await streamNdjsonRows(Readable.from(chunks()), async (rows) => {
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("large-row");
    const content = rows[0].content as string;
    expect(content.length).toBe(size);
    expect(content.at(-1)).toBe("x");
    received++;
  });
  expect(count).toBe(1);
  expect(received).toBe(1);
});

describe("large restore blobs", () => {
  it("sends a logical blob as bounded requests with its full size and SHA", async () => {
    const bytes = Buffer.alloc(13 * 1024 * 1024, 123);
    const requests: Array<Array<Record<string, unknown>>> = [];
    await sendRestoreBlobRows(
      [
        {
          storageKey: "attachments/large.bin",
          mimeType: "application/octet-stream",
          base64: bytes.toString("base64"),
        },
      ],
      async (rows) => {
        requests.push(rows);
      },
      1,
    );
    expect(requests).toHaveLength(3);
    const restored = requests.map((rows, index) => {
      expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(9 * 1024 * 1024);
      expect(rows[0].chunk).toEqual({
        partNumber: index + 1,
        totalParts: 3,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      return Buffer.from(rows[0].base64 as string, "base64");
    });
    expect(Buffer.concat(restored).equals(bytes)).toBe(true);
  });

  it("refuses a large blob on an older server before sending unknown chunk fields", async () => {
    let sent = false;
    await expect(
      sendRestoreBlobRows(
        [
          {
            storageKey: "attachments/large.bin",
            base64: Buffer.alloc(13 * 1024 * 1024).toString("base64"),
          },
        ],
        async () => {
          sent = true;
        },
      ),
    ).rejects.toThrow(/Upgrade the server.*chunked full restores/);
    expect(sent).toBe(false);
  });
});

describe("raw v2 archive blob boundaries", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  const key = "attachments/raw-boundary.bin";
  const metadataPath = `blobs/attachments/${createHash("sha256").update(key).digest("hex")}.json`;
  const archive = async (
    entries: Array<[string, string | Buffer]>,
    tables: Record<string, number> = {},
  ) => {
    const directory = mkdtempSync(join(tmpdir(), "busabase-raw-import-test-"));
    directories.push(directory);
    const path = join(directory, "test.bbdump");
    const writer = ArchiveWriter.create(path);
    for (const [name, body] of entries) await writer.addBuffer(name, body);
    await writer.finalize({
      formatVersion: FORMAT_VERSION,
      toolVersion: "test",
      exportedAt: new Date().toISOString(),
      spaceId: "source",
      sourceHost: "http://localhost",
      fidelity: "full",
      excludesSecrets: true,
      tables,
      blobCount: 1,
      blobBytes: 0,
      textBlobCount: 0,
      textBlobBytes: 0,
    });
    return path;
  };
  const fake = () => {
    const sent: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
    const abort = vi.fn(async () => ({ ok: true }));
    const commit = vi.fn(
      async (): Promise<{ ok: boolean; warnings: string[]; notices?: string[] }> => ({
        ok: true,
        warnings: [],
      }),
    );
    const client = {
      dump: {
        importBegin: async () => ({ sessionId: "test", blobChunkProtocol: 1 }),
        importTables: async (input: { table: string; rows: Array<Record<string, unknown>> }) => {
          sent.push(input);
          return { inserted: input.rows.length };
        },
        importCommit: commit,
        importAbort: abort,
      },
    } as unknown as BusabaseClient;
    return { client, sent, abort, commit };
  };
  const metadata = (bytes: Buffer) =>
    JSON.stringify({
      storageKey: key,
      mimeType: "application/octet-stream",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  it.each([false, true])(
    "fails an incomplete target commit and rolls back only a fresh restore (resume=%s)",
    async (resume) => {
      const path = await archive([]);
      const { client, abort, commit } = fake();
      commit.mockResolvedValue({ ok: false, warnings: ["One attachment has no physical bytes"] });
      await expect(
        importFull({ client, archivePath: path, sourceSpaceId: "source", resume }),
      ).rejects.toThrow(/did not pass.*One attachment/);
      expect(abort).toHaveBeenCalledTimes(resume ? 0 : 1);
    },
  );
  it("preserves successful credential reconnection notices without treating them as corruption", async () => {
    const path = await archive([]);
    const { client, abort, commit } = fake();
    commit.mockResolvedValue({
      ok: true,
      warnings: [],
      notices: ["Reconnect the disabled webhook rule"],
    });
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).resolves.toEqual({
      ok: true,
      warnings: [],
      notices: ["Reconnect the disabled webhook rule"],
    });
    expect(abort).not.toHaveBeenCalled();
  });
  it.each([
    "tree/futureTable.ndjson",
    "future/critical.json",
    "docs/nested/document.md",
    "tree/records.json",
  ])("rejects an operative unknown entry %s instead of returning success", async (entry) => {
    const path = await archive([[entry, "{}\n"]]);
    await expect(verifyArchive(path)).resolves.toMatchObject({ formatVersion: 2 });
    const { client, sent, abort, commit } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).rejects.toThrow(/Unsupported archive table|Unrecognized archive entry/);
    expect(sent).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("also rejects an unsupported manifest declaration when called directly", async () => {
    const path = await archive([], { futureTable: 0 });
    const { client, abort, commit } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).rejects.toThrow(/unsupported table.*futureTable/);
    expect(abort).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps zero-byte raw entries as an exact empty inline blob", async () => {
    const path = await archive([
      [metadataPath, metadata(Buffer.alloc(0))],
      [metadataPath.replace(/\.json$/, ".bin"), Buffer.alloc(0)],
    ]);
    const { client, sent, abort } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).resolves.toEqual({ ok: true, warnings: [] });
    expect(sent[0]).toMatchObject({
      table: "attachmentBlobs",
      rows: [{ storageKey: key, mimeType: "application/octet-stream", base64: "" }],
    });
    expect(abort).not.toHaveBeenCalled();
  });
  it("rejects a raw metadata key that disagrees with its archive identity", async () => {
    const path = await archive([
      [
        metadataPath,
        JSON.stringify({
          storageKey: "attachments/other.bin",
          bytes: 0,
          sha256: createHash("sha256").digest("hex"),
        }),
      ],
      [metadataPath.replace(/\.json$/, ".bin"), Buffer.alloc(0)],
    ]);
    const { client, sent, abort } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).rejects.toThrow(/invalid identity/);
    expect(sent).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
  });
  it("requires the matching binary immediately after its metadata", async () => {
    const path = await archive([
      [metadataPath, metadata(Buffer.from("raw"))],
      ["docs/unrelated.md", "interposed"],
      [metadataPath.replace(/\.json$/, ".bin"), "raw"],
    ]);
    const { client, sent, abort } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).rejects.toThrow(/Expected raw blob entry/);
    expect(sent).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
  });
  it("rejects changed raw bytes before sending the final part", async () => {
    const path = await archive([
      [metadataPath, metadata(Buffer.from("original"))],
      [metadataPath.replace(/\.json$/, ".bin"), "modified"],
    ]);
    const { client, sent, abort } = fake();
    await expect(
      importFull({ client, archivePath: path, sourceSpaceId: "source" }),
    ).rejects.toThrow(/incorrect size or SHA/);
    expect(sent).toEqual([]);
    expect(abort).toHaveBeenCalledOnce();
  });
});
