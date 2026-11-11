import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevAttachmentRoute, createDevUploadRoute } from "./dev-routes";
import { resetStorage } from "./factory";
import { LocalStorage } from "./local";

/**
 * The dev upload relay's real behavior: it must accept the SAME shape a client
 * uses for an S3 presigned upload — a raw PUT with the bytes as body and the key
 * in `?key=` — so no client ever has to know it's talking to a local dev server.
 * The legacy multipart POST must keep working alongside it.
 *
 * Drives the actual route handlers against a real LocalStorage on a temp dir and
 * reads the bytes back off disk, rather than asserting on the response shape.
 */
describe("createDevUploadRoute", () => {
  let dir: string;
  let originalPublicBaseUrl: string | undefined;

  beforeEach(() => {
    originalPublicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL;
    dir = mkdtempSync(join(tmpdir(), "dev-upload-route-"));
    process.env.STORAGE_URL = `local:${dir}?base_url=/api/test/storage`;
    process.env.NODE_ENV = "test";
    resetStorage();
  });

  afterEach(() => {
    if (originalPublicBaseUrl === undefined) {
      delete process.env.STORAGE_PUBLIC_BASE_URL;
    } else {
      process.env.STORAGE_PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
    resetStorage();
    rmSync(dir, { recursive: true, force: true });
  });

  const bytesOnDisk = (key: string): Buffer => readFileSync(join(dir, key));

  it("PUT writes the raw body to storage at the ?key= key (the S3-presigned shape)", async () => {
    const { PUT } = createDevUploadRoute();
    const body = Buffer.from("hello raw put");
    const res = await PUT(
      new Request("http://localhost/api/dev/upload?key=uploads/a/b.txt", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body,
      }),
    );
    expect(res.status).toBe(200);
    expect(bytesOnDisk("uploads/a/b.txt").toString()).toBe("hello raw put");
  });

  it("PUT rejects a request with no key (a client that lost the query string)", async () => {
    const { PUT } = createDevUploadRoute();
    const res = await PUT(
      new Request("http://localhost/api/dev/upload", { method: "PUT", body: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a truncated PUT before overwriting a previously stored object", async () => {
    const key = "report.bin";
    const original = Buffer.from("the complete original report");
    writeFileSync(join(dir, key), original);
    const { PUT } = createDevUploadRoute();
    const response = await PUT(
      new Request(`http://localhost/api/dev/upload?key=${key}`, {
        method: "PUT",
        headers: { "content-length": String(original.length) },
        body: original.subarray(0, 8),
      }),
    );

    expect(response.status).toBe(400);
    expect(bytesOnDisk(key)).toEqual(original);
  });

  it("checks the presigned byte length even when a PUT has no Content-Length header", async () => {
    const { PUT } = createDevUploadRoute();
    const response = await PUT(
      new Request("http://localhost/api/dev/upload?key=report.bin&contentLength=20", {
        method: "PUT",
        body: Buffer.from("short"),
      }),
    );

    expect(response.status).toBe(400);
    expect(existsSync(join(dir, "report.bin"))).toBe(false);
  });

  it("verifies a content-addressed SHA-256 key before writing a Busabase upload", async () => {
    const complete = Buffer.from("complete attachment bytes");
    const hash = createHash("sha256").update(complete).digest("hex");
    const key = `attachments/local/spaces/local/blobs/sha256/${hash.slice(0, 2)}/${hash}.bin`;
    const { PUT } = createDevUploadRoute({ verifyContentAddressedKey: true });
    const truncated = await PUT(
      new Request(`http://localhost/api/storage/upload?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        body: complete.subarray(0, 8),
      }),
    );
    expect(truncated.status).toBe(400);
    expect(existsSync(join(dir, key))).toBe(false);

    const uploaded = await PUT(
      new Request(`http://localhost/api/storage/upload?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        body: complete,
      }),
    );
    expect(uploaded.status).toBe(200);
    expect(bytesOnDisk(key)).toEqual(complete);
  });

  it("applies the same content-addressed check to legacy multipart POST uploads", async () => {
    const digest = createHash("sha256").update("expected bytes").digest("hex");
    const key = `attachments/local/blobs/sha256/${digest.slice(0, 2)}/${digest}.bin`;
    const form = new FormData();
    form.append("file", new Blob(["wrong bytes"]), "report.bin");
    form.append("storageKey", key);
    const { POST } = createDevUploadRoute({ verifyContentAddressedKey: true });
    const response = await POST(
      new Request("http://localhost/api/storage/upload", { method: "POST", body: form }),
    );
    expect(response.status).toBe(400);
    expect(existsSync(join(dir, key))).toBe(false);
  });

  it("POST still writes a multipart file+storageKey (legacy path preserved)", async () => {
    const { POST } = createDevUploadRoute();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(Buffer.from("legacy post"))]), "b.txt");
    form.append("storageKey", "uploads/legacy.txt");
    const res = await POST(
      new Request("http://localhost/api/dev/upload", { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
    expect(bytesOnDisk("uploads/legacy.txt").toString()).toBe("legacy post");
  });

  it("resolveStorage routes a PUT by its query params (how buda picks Buda Drive)", async () => {
    const altDir = mkdtempSync(join(tmpdir(), "dev-upload-route-alt-"));
    try {
      const altStorage = new LocalStorage({
        provider: "local",
        bucketName: "alt",
        localRoot: altDir,
        localBaseUrl: "/x",
      });
      // Route to the alternate adapter only when ?drive=alt; anything else falls to
      // the default (dir), so writing to altDir proves the query actually decided it.
      const { PUT } = createDevUploadRoute({
        resolveStorage: ({ params }) =>
          params?.get("drive") === "alt"
            ? altStorage
            : new LocalStorage({
                provider: "local",
                bucketName: "def",
                localRoot: dir,
                localBaseUrl: "/x",
              }),
      });
      await PUT(
        new Request("http://localhost/api/dev/upload?key=k/f.bin&drive=alt", {
          method: "PUT",
          body: Buffer.from("routed"),
        }),
      );
      expect(readFileSync(join(altDir, "k/f.bin")).toString()).toBe("routed");
    } finally {
      rmSync(altDir, { recursive: true, force: true });
    }
  });

  it("is gated in production by default", async () => {
    process.env.NODE_ENV = "production";
    const { PUT, POST } = createDevUploadRoute();
    const put = await PUT(
      new Request("http://localhost/api/dev/upload?key=k.txt", { method: "PUT", body: "x" }),
    );
    const post = await POST(
      new Request("http://localhost/api/dev/upload", { method: "POST", body: new FormData() }),
    );
    expect(put.status).toBe(404);
    expect(post.status).toBe(404);
  });

  it("buda's gateProduction:false lets the relay run in production", async () => {
    process.env.NODE_ENV = "production";
    const { PUT } = createDevUploadRoute({ gateProduction: false });
    const res = await PUT(
      new Request("http://localhost/api/dev/upload?key=prod/ok.txt", {
        method: "PUT",
        body: Buffer.from("prod bytes"),
      }),
    );
    expect(res.status).toBe(200);
    expect(bytesOnDisk("prod/ok.txt").toString()).toBe("prod bytes");
  });

  it("can read from the upload adapter despite a stale public base URL", async () => {
    const key = "attachments/community/post.png";
    const body = Buffer.from("community image bytes");
    const { PUT } = createDevUploadRoute();
    const upload = await PUT(
      new Request(`http://localhost/api/dev/upload?key=${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body,
      }),
    );
    expect(upload.status).toBe(200);

    process.env.STORAGE_PUBLIC_BASE_URL = "http://127.0.0.1:1/wrong-bucket";
    const { GET } = createDevAttachmentRoute({ preferStorageAdapter: true });
    const response = await GET(new Request(`http://localhost/api/dev/attachment/${key}`), {
      params: Promise.resolve({ key: key.split("/") }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });
});
