import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Busabase } from "./index.js";

/**
 * `uploadAsset` over a real HTTP server — no injected fetch, no mocked
 * `Response`.
 *
 * `asset-upload.test.ts` next door hands the function a stub client and a
 * `vi.fn()` fetch. That proves the sequence and the branching, but no byte ever
 * reaches a socket: a body that silently stringified would still satisfy
 * `toMatchObject({ method: "PUT" })`. The reason the PUT body needs a cast at
 * all is that a `Uint8Array` has to survive the trip unchanged, so these tests
 * run the real path and compare what the server received against what the
 * caller handed in.
 */

interface PutRecord {
  body: Buffer;
  contentType: string | undefined;
}

let server: Server;
let baseUrl: string;

/** Set per test to drive the server's answer for the next upload. */
let duplicateNext = false;
let failPutNext = false;
const puts: PutRecord[] = [];
const paths: string[] = [];

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function reset() {
  puts.length = 0;
  paths.length = 0;
  duplicateNext = false;
  failPutNext = false;
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    paths.push(`${req.method} ${url.pathname}`);
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === "/api/v1/assets/upload-urls") {
      await readBody(req);
      if (duplicateNext) {
        // The dedup response carries the ids directly and an empty uploadUrl —
        // uploading against it would be an error, not a slower success.
        json(200, {
          duplicate: true,
          expiresIn: 0,
          uploadUrl: "",
          storageKey: "assets/journey.png",
          assetId: "ast_dedup",
          attachmentId: "att_dedup",
          publicUrl: `${baseUrl}/cdn/journey.png`,
        });
        return;
      }
      json(200, {
        duplicate: false,
        expiresIn: 3600,
        publicUrl: `${baseUrl}/cdn/journey.png`,
        storageKey: "assets/journey.png",
        uploadUrl: `${baseUrl}/put/journey.png`,
      });
      return;
    }

    if (url.pathname === "/put/journey.png" && req.method === "PUT") {
      const body = await readBody(req);
      puts.push({ body, contentType: req.headers["content-type"] });
      if (failPutNext) {
        res.writeHead(500);
        res.end("storage refused the object");
        return;
      }
      res.writeHead(200);
      res.end();
      return;
    }

    if (url.pathname === "/api/v1/assets/confirmations") {
      await readBody(req);
      json(200, {
        success: true,
        assetId: "ast_real_1",
        attachmentId: "att_real_1",
        storageKey: "assets/journey.png",
        publicUrl: `${baseUrl}/cdn/journey.png`,
      });
      return;
    }

    json(404, { error: "not found", path: url.pathname });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("uploadAsset over a real HTTP round-trip", () => {
  it("puts the bytes on the wire unchanged and returns every id a caller needs", async () => {
    reset();
    // Deliberately not ASCII: a NUL, a high byte and a lone 0x80 are exactly
    // what a string-coerced body mangles.
    const bytes = new Uint8Array([0x00, 0x80, 0xff, 0x41, 0x0a, 0xc3, 0x28]);

    const bb = new Busabase({ baseUrl, apiKey: "sk_integration" });
    const asset = await bb.uploadAsset(bytes, {
      fileName: "user-journey.png",
      mimeType: "image/png",
    });

    expect(puts).toHaveLength(1);
    expect(puts[0]?.contentType).toBe("image/png");
    // Byte-for-byte, after a real socket round-trip.
    expect(Buffer.compare(puts[0]?.body ?? Buffer.alloc(0), Buffer.from(bytes))).toBe(0);

    expect(asset).toMatchObject({
      assetId: "ast_real_1",
      attachmentId: "att_real_1",
      url: `${baseUrl}/cdn/journey.png`,
      fileName: "user-journey.png",
      mimeType: "image/png",
      size: bytes.byteLength,
    });
    expect(asset.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("sends no PUT at all when the library already holds those bytes", async () => {
    reset();
    duplicateNext = true;

    const bb = new Busabase({ baseUrl, apiKey: "sk_integration" });
    const asset = await bb.uploadAsset(new Uint8Array([1, 2, 3]), {
      fileName: "user-journey.png",
      mimeType: "image/png",
    });

    expect(puts).toHaveLength(0);
    // Not even a confirm: the dedup response is the whole answer.
    expect(paths).toEqual(["POST /api/v1/assets/upload-urls"]);
    expect(asset).toMatchObject({
      assetId: "ast_dedup",
      attachmentId: "att_dedup",
      size: 3,
    });
  });

  it("names the file, the status and the server's words when the PUT is rejected", async () => {
    reset();
    failPutNext = true;

    const bb = new Busabase({ baseUrl, apiKey: "sk_integration" });
    await expect(
      bb.uploadAsset(new Uint8Array([1, 2, 3]), {
        fileName: "user-journey.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow(
      /presigned upload of user-journey\.png failed \(500 .*storage refused the object/s,
    );
    // The confirm must not run after a failed upload.
    expect(paths).not.toContain("POST /api/v1/assets/confirmations");
  });

  it("refuses an empty file without touching the network", async () => {
    reset();

    const bb = new Busabase({ baseUrl, apiKey: "sk_integration" });
    await expect(
      bb.uploadAsset(new Uint8Array([]), { fileName: "empty.png", mimeType: "image/png" }),
    ).rejects.toThrow(/empty/);
    expect(paths).toEqual([]);
  });
});
