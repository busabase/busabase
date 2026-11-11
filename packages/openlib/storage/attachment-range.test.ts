import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDevAttachmentRoute } from "./dev-routes";
import { resetStorage, storage } from "./factory";
import { LocalStorage } from "./local";

describe("local attachment HTTP reads", () => {
  let dir: string;
  const body = Buffer.from("0123456789");

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "attachment-range-"));
    vi.stubEnv("STORAGE_URL", `local:${dir}?base_url=/api/storage`);
    vi.stubEnv("STORAGE_PUBLIC_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    resetStorage();
    await storage.uploadFileToKey(body, "media/voice.wav", "audio/wav");
  });

  afterEach(() => {
    resetStorage();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const read = (headers?: HeadersInit, method = "GET", key = "media/voice.wav", options = {}) =>
    createDevAttachmentRoute(options).GET(
      new Request(`http://localhost/api/storage/${key}`, { method, headers }),
      { params: Promise.resolve({ key: key.split("/") }) },
    );

  it("serves original bytes with a media MIME, length and range advertisement", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
  });

  it.each([
    ["bytes=0-1", "01", "bytes 0-1/10"],
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=8-", "89", "bytes 8-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=0-99", "0123456789", "bytes 0-9/10"],
    ["bytes=-99", "0123456789", "bytes 0-9/10"],
    ["bytes=0-999999999999999999999999999", "0123456789", "bytes 0-9/10"],
    ["bytes=-999999999999999999999999999", "0123456789", "bytes 0-9/10"],
  ])("serves %s using the adapter's bounded read", async (range, expected, contentRange) => {
    const fullRead = vi.spyOn(LocalStorage.prototype, "getObject");
    const rangeRead = vi.spyOn(LocalStorage.prototype, "getObjectRange");
    const response = await read({ Range: range });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(expected.length));
    expect(await response.text()).toBe(expected);
    expect(rangeRead).toHaveBeenCalledOnce();
    expect(fullRead).not.toHaveBeenCalled();
  });

  it.each([
    "bytes=10-",
    "bytes=9-2",
    "bytes=-0",
    "bytes=",
    "bytes=-",
    "bytes=abc",
    "bytes=-1-2",
    "bytes=999999999999999999999999999-",
  ])("returns an empty 416 with total length for %s", async (range) => {
    const rangeRead = vi.spyOn(LocalStorage.prototype, "getObjectRange");
    const response = await read({ Range: range });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
    expect(rangeRead).not.toHaveBeenCalled();
  });

  it.each(["items=0-1", "bytes=0-1,4-5"])(
    "falls back to the complete object for unsupported range shape %s",
    async (range) => {
      const response = await read({ Range: range });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-range")).toBeNull();
      expect(await response.text()).toBe(body.toString());
    },
  );

  it("ignores If-Range rather than returning partial bytes against an unverified validator", async () => {
    const response = await read({ Range: "bytes=0-1", "If-Range": '"old-version"' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body.toString());
  });

  it("serves HEAD metadata without reading the file body or honoring Range", async () => {
    const fullRead = vi.spyOn(LocalStorage.prototype, "getObject");
    const rangeRead = vi.spyOn(LocalStorage.prototype, "getObjectRange");
    const response = await read({ Range: "bytes=0-1" }, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe("");
    expect(fullRead).not.toHaveBeenCalled();
    expect(rangeRead).not.toHaveBeenCalled();
  });

  it("serves an empty file whole and rejects a byte range against it", async () => {
    await storage.uploadFileToKey(Buffer.alloc(0), "empty.wav", "audio/wav");
    const full = await read(undefined, "GET", "empty.wav");
    expect(full.status).toBe(200);
    expect(full.headers.get("content-length")).toBe("0");
    expect(await full.text()).toBe("");
    const range = await read({ Range: "bytes=0-0" }, "GET", "empty.wav");
    expect(range.status).toBe(416);
    expect(range.headers.get("content-range")).toBe("bytes */0");
  });

  it.each([
    ["movie.MP4", "video/mp4"],
    ["voice.mp3", "audio/mpeg"],
    ["voice.m4a", "audio/mp4"],
    ["movie.webm", "video/webm"],
    ["page.html", "application/octet-stream"],
  ])(
    "serves %s with %s while preserving existing active-document policy",
    async (key, contentType) => {
      await storage.uploadFileToKey(body, key, "application/octet-stream");
      const response = await read(undefined, "GET", key);
      expect(response.headers.get("content-type")).toBe(contentType);
    },
  );

  it("preserves the default production gate and supports real production storage routes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await read({ Range: "bytes=0-1" })).status).toBe(404);
    const response = await read({ Range: "bytes=0-1" }, "GET", "media/voice.wav", {
      gateProduction: false,
    });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("01");
  });

  it("rejects unsafe keys before metadata or reads, and keeps missing objects at 404", async () => {
    const metadata = vi.spyOn(LocalStorage.prototype, "getObjectMetadata");
    expect((await read({ Range: "bytes=0-1" }, "GET", "../outside.wav")).status).toBe(400);
    expect(metadata).not.toHaveBeenCalled();
    expect((await read({ Range: "bytes=0-1" }, "GET", "missing.wav")).status).toBe(404);
  });

  it("preserves the public-base proxy strategy and its preferStorageAdapter override", async () => {
    vi.stubEnv("STORAGE_PUBLIC_BASE_URL", "https://cdn.example.test/objects");
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("upstream", { headers: { "content-type": "audio/wav" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await (await read({ Range: "bytes=0-1" })).text()).toBe("upstream");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://cdn.example.test/objects/media/voice.wav",
    );
    const local = await read({ Range: "bytes=0-1" }, "GET", "media/voice.wav", {
      preferStorageAdapter: true,
    });
    expect(local.status).toBe(206);
    expect(await local.text()).toBe("01");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
