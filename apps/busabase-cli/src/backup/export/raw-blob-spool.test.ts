import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalHash, RawBlobSpool } from "./raw-blob-spool.js";

const run = promisify(execFile);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("raw backup blob spool", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "busabase-raw-spool-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("resumes verified bytes using atomic receipts and ignores interrupted files", async () => {
    const path = join(directory, "objects.part");
    const key = "attachments/original/video.mp4";
    const bytes = Buffer.from("original\r\nbytes");
    const spool = await RawBlobSpool.open(path, "attachments", false);
    await spool.download(
      new Response(bytes),
      key,
      "video/mp4",
      [`sha256:${hash(bytes)}`],
      "test object",
    );
    await writeFile(join(path, "interrupted.downloading"), "partial");
    const resumed = await RawBlobSpool.open(path, "attachments", true);
    const result = await resumed.recover(new Map([[key, `sha256:${hash(bytes)}`]]));
    expect(result).toEqual({ keys: new Set([key]), count: 1, bytes: bytes.length });
    const parts: Array<{ path: string; bytes: Buffer }> = [];
    await resumed.finish(
      {
        addBuffer: async (path, bytes) => {
          parts.push({ path, bytes: Buffer.from(bytes) });
        },
        addStream: async (path, size, stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          expect(bytes.length).toBe(size);
          parts.push({ path, bytes });
        },
      },
      [key],
    );
    const digest = hash(Buffer.from(key));
    expect(parts.map((part) => part.path)).toEqual([
      `blobs/attachments/${digest}.json`,
      `blobs/attachments/${digest}.bin`,
    ]);
    expect(JSON.parse(parts[0].bytes.toString())).toEqual({
      storageKey: key,
      mimeType: "video/mp4",
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    expect(parts[1].bytes).toEqual(bytes);
    await resumed.cleanup();
    expect(await readdir(directory)).toEqual([]);
  });

  it.each(["bare", "uppercase", "prefixed-uppercase"])(
    "accepts a valid %s registered SHA for download and resume",
    async (form) => {
      const bytes = Buffer.from("legacy source bytes\r\n");
      const bare = hash(bytes);
      const registered =
        form === "bare"
          ? bare
          : form === "uppercase"
            ? bare.toUpperCase()
            : `SHA256:${bare.toUpperCase()}`;
      const path = join(directory, "legacy-hash.part");
      const key = "attachments/legacy-source.txt";
      const spool = await RawBlobSpool.open(path, "attachments", false);
      await spool.download(new Response(bytes), key, "text/plain", [registered], "legacy source");
      const resumed = await RawBlobSpool.open(path, "attachments", true);
      expect(await resumed.recover(new Map([[key, registered]]))).toEqual({
        keys: new Set([key]),
        count: 1,
        bytes: bytes.length,
      });
      await expect(
        spool.download(new Response("changed"), key, "text/plain", [registered], "legacy source"),
      ).rejects.toThrow(/Content hash mismatch/);
    },
  );

  it.each([
    "md5:0123456789abcdef0123456789abcdef",
    "a".repeat(32),
    "g".repeat(64),
    `sha256:${"a".repeat(63)}`,
    ` ${"a".repeat(64)}`,
    "",
  ])("rejects unsupported registered hash %s", (invalid) => {
    expect(() => canonicalHash(invalid, "test object")).toThrow(
      /Unsupported registered content hash/,
    );
  });

  it("refuses to finalize when a required attachment key was never downloaded", async () => {
    const path = join(directory, "objects.part");
    const spool = await RawBlobSpool.open(path, "attachments", false);
    await spool.download(
      new Response("present"),
      "attachments/present.bin",
      "text/plain",
      [],
      "present object",
    );
    await expect(
      spool.finish(
        {
          addBuffer: async () => undefined,
          addStream: async () => undefined,
        },
        ["attachments/present.bin", "attachments/missing-file-tree.bin"],
      ),
    ).rejects.toThrow(/Full backup incomplete.*attachments\/missing-file-tree\.bin/);
  });

  it("rejects corrupt resumed raw bytes and streamed hash mismatches", async () => {
    const path = join(directory, "objects.part");
    const key = "key";
    const bytes = Buffer.from("good");
    const spool = await RawBlobSpool.open(path, "attachments", false);
    await expect(
      spool.download(
        new Response("bad"),
        key,
        "text/plain",
        [`sha256:${hash(bytes)}`],
        "test object",
      ),
    ).rejects.toThrow("Content hash mismatch");
    expect(await readdir(path)).toEqual([]);
    await spool.download(new Response(bytes), key, "text/plain", [], "test object");
    await writeFile(join(path, `${hash(Buffer.from(key))}.bin`), "bad");
    await expect(spool.recover(new Map([[key, undefined]]))).rejects.toThrow("resumed attachment");
  });

  it("migrates small complete legacy spool rows while discarding interrupted tail", async () => {
    const path = join(directory, "objects.part");
    await writeFile(
      path,
      `${JSON.stringify({ textStorageKey: "text/key", base64: Buffer.from("你好").toString("base64") })}\n{"partial":`,
    );
    const spool = await RawBlobSpool.open(path, "asset-texts", true);
    const result = await spool.recover(new Map([["text/key", undefined]]));
    expect(result.count).toBe(1);
    expect(result.bytes).toBe(Buffer.byteLength("你好"));
    const names = await readdir(path);
    expect(names.filter((name) => name.endsWith(".bin"))).toHaveLength(1);
    const binary = names.find((name) => name.endsWith(".bin"));
    if (!binary) throw new Error("Legacy migration did not publish its raw object");
    expect(await readFile(join(path, binary))).toEqual(Buffer.from("你好"));
  });

  it("exports, verifies and restores a >384MiB object under a 96MB heap", async () => {
    const fixture = join(directory, "big-blob.mjs");
    const outPath = join(directory, "large.bbdump");
    await writeFile(
      fixture,
      `
import {createHash} from 'node:crypto';
import {exportFull} from ${JSON.stringify(new URL("./full-exporter.ts", import.meta.url).href)};
import {verifyArchive} from ${JSON.stringify(new URL("../format/archive-reader.ts", import.meta.url).href)};
import {importFull} from ${JSON.stringify(new URL("../import/full-importer.ts", import.meta.url).href)};
const size=400*1024*1024+17, block=Buffer.alloc(64*1024,0x5a),expected=createHash('sha256');
for(let offset=0;offset<size;offset+=block.length)expected.update(block.subarray(0,Math.min(block.length,size-offset)));
const sha256=expected.digest('hex'),key='attachments/source/big.bin';
globalThis.fetch=async()=>{let sent=0;return new Response(new ReadableStream({pull(controller){if(sent===size){controller.close();return;}const bytes=block.subarray(0,Math.min(block.length,size-sent));sent+=bytes.length;controller.enqueue(bytes);}}));};
const source={dump:{exportTables:async({table})=>({rows:table==='attachments'?[{id:'attachment',storageKey:key,mimeType:'application/octet-stream',sizeBytes:size,contentHash:'sha256:'+sha256}]:[],nextCursor:null}),exportAttachment:async()=>({attachmentId:'attachment',storageKey:key,downloadUrl:'http://bytes.invalid/big.bin',mimeType:'application/octet-stream',contentHash:'sha256:'+sha256,sizeBytes:size})}};
const manifest=await exportFull({client:source,outPath:process.argv[2],spaceId:'source',sourceHost:'http://source.invalid',includeHistory:true,toolVersion:'test',retries:0});
await verifyArchive(process.argv[2]);const actual=createHash('sha256');let received=0,parts=0;
const target={dump:{importBegin:async()=>({sessionId:'session',blobChunkProtocol:1,exactReplayProtocol:1}),importTables:async({table,rows:plainRows,rowsJson})=>{const rows=rowsJson===undefined?(plainRows??[]):JSON.parse(rowsJson);if(table==='attachmentBlobs')for(const row of rows){const buf=Buffer.from(row.base64,'base64');if(buf.length>6*1024*1024)throw Error('unbounded request');if(row.chunk&&row.chunk.partNumber!==parts+1)throw Error('out of order');parts++;actual.update(buf);received+=buf.length;}return {inserted:rows.length};},importCommit:async()=>({ok:true,warnings:[]}),importAbort:async()=>({ok:true})}};
await importFull({client:target,archivePath:process.argv[2],sourceSpaceId:'source'});
if(received!==size||actual.digest('hex')!==sha256||manifest.blobBytes!==size||manifest.blobCount!==1)throw Error('byte integrity failed');
console.log(JSON.stringify({bytes:received,parts,sha256,heapLimitMB:96}));
`,
    );
    const result = await run(
      process.execPath,
      ["--max-old-space-size=96", "--import", import.meta.resolve("tsx"), fixture, outPath],
      { env: { ...process.env, TMPDIR: directory }, timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      bytes: 400 * 1024 * 1024 + 17,
      parts: 67,
      heapLimitMB: 96,
    });
  }, 125_000);
});
