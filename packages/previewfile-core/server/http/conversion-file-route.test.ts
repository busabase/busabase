import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConversionFileRoute } from "./conversion-file-route";

const get = (key: string[]) =>
  createConversionFileRoute().GET(new Request("https://host.example/api/convert/pdf-file/x"), {
    params: Promise.resolve({ key }),
  });

describe("createConversionFileRoute", () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "conversion-file-"));
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${storageDir}`);
    await fs.mkdir(path.join(storageDir, "conversions"), { recursive: true });
    await fs.writeFile(path.join(storageDir, "conversions", "abc.pdf"), "%PDF-1.4 test");
    await fs.writeFile(path.join(storageDir, "secret.txt"), "not an output");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("serves a converted PDF inline", async () => {
    const response = await get(["conversions", "abc.pdf"]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(await response.text()).toBe("%PDF-1.4 test");
  });

  it("only serves files under conversions/", async () => {
    expect((await get(["secret.txt"])).status).toBe(403);
    expect((await get(["conversions", "..", "secret.txt"])).status).toBe(403);
    expect((await get(["conversions", "..", "..", "etc", "passwd"])).status).toBe(403);
  });

  it("answers 404 for a missing output", async () => {
    expect((await get(["conversions", "missing.pdf"])).status).toBe(404);
  });

  it("serves staged sources without caching only before their short expiry", async () => {
    const expiresAt = Date.now() + 30_000;
    const name = `${expiresAt}-12345678-1234-1234-1234-123456789abc`;
    await fs.mkdir(path.join(storageDir, "conversions", "sources"));
    await fs.writeFile(path.join(storageDir, "conversions", "sources", name), "private source");
    const response = await get(["conversions", "sources", name]);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("private source");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(expiresAt + 1);
      expect((await get(["conversions", "sources", name])).status).toBe(404);
      expect((await get(["conversions", "", "sources", name])).status).toBe(404);
      expect((await get(["conversions", ".", "sources", name])).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serves staged media with its actual inert MIME type", async () => {
    const name = `${Date.now() + 30_000}-12345678-1234-1234-1234-123456789abc.mp4`;
    await fs.mkdir(path.join(storageDir, "conversions", "sources"));
    await fs.writeFile(path.join(storageDir, "conversions", "sources", name), "video bytes");
    const response = await get(["conversions", "sources", name]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is unavailable when conversion storage is remote", async () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "s3://key:secret@bucket?endpoint=https://s3.example");
    expect((await get(["conversions", "abc.pdf"])).status).toBe(404);
  });
});
