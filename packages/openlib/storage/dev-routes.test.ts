import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDevUploadRoute } from "./dev-routes";
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dev-upload-route-"));
    process.env.STORAGE_URL = `local:${dir}?base_url=/api/test/storage`;
    process.env.NODE_ENV = "test";
    resetStorage();
  });

  afterEach(() => {
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
});
