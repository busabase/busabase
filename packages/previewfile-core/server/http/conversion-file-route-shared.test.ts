import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as conversionStorage from "../converter/conversion-storage";
import {
  configurePublicConversionStorage,
  resetConversionStorage,
} from "../converter/conversion-storage";
import { createConversionFileRoute } from "./conversion-file-route";

const store = vi.hoisted(() => ({
  objectExists: vi.fn(),
  getObject: vi.fn(),
}));
vi.mock("openlib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openlib/storage")>()),
  createStorage: (url: string) => {
    if (url.startsWith("s3:")) return store;
    throw new Error("unexpected local storage read");
  },
}));

const key = `conversions/${"a".repeat(64)}.pdf`;
const get = (value: string[], shared = true) =>
  createConversionFileRoute({ serveSharedOutputs: shared }).GET(
    new Request("https://host.example/api/convert/pdf-file/x"),
    { params: Promise.resolve({ key: value }) },
  );

describe("shared conversion output serving", () => {
  beforeEach(() => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "");
    vi.stubEnv("BUDA_DRIVE_URL", "");
    configurePublicConversionStorage("s3://key:secret@s3.example/bucket");
    store.objectExists.mockReset().mockResolvedValue(true);
    store.getObject.mockReset().mockResolvedValue(Buffer.from("%PDF-1.4 shared output"));
  });
  afterEach(() => {
    configurePublicConversionStorage();
    resetConversionStorage();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads a hash-addressed PDF from shared storage without redirecting the browser", async () => {
    const response = await get(key.split("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("%PDF-1.4 shared output");
    expect(store.getObject).toHaveBeenCalledExactlyOnceWith(key);
  });

  it("returns 404 when the shared object is absent", async () => {
    store.objectExists.mockResolvedValue(false);
    expect((await get(key.split("/"))).status).toBe(404);
    expect(store.getObject).not.toHaveBeenCalled();
  });

  it.each([
    ["attachments", "secret.pdf"],
    ["private-conversions", "12345678-1234-1234-1234-123456789abc.pdf"],
    ["conversions", "..", "secret.pdf"],
    ["conversions", "invalid.pdf"],
    ["conversions", `${"a".repeat(64)}.js`],
  ])("refuses non-public keys %j before accessing shared storage", async (...segments) => {
    expect((await get(segments)).status).toBe(403);
    expect(store.objectExists).not.toHaveBeenCalled();
    expect(store.getObject).not.toHaveBeenCalled();
  });

  it("does not enable shared reads for hosts that did not opt in", async () => {
    // The original host default still reads its own local storage.
    expect((await get(key.split("/"), false)).status).toBe(404);
    expect(store.getObject).not.toHaveBeenCalled();
  });

  it("keeps staged source bytes on their separate local storage with expiry checks", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "conversion-private-source-"));
    try {
      vi.spyOn(conversionStorage, "getLocalConversionRootDir").mockReturnValue(dir);
      const expiresAt = Date.now() + 30_000;
      const name = `${expiresAt}-12345678-1234-1234-1234-123456789abc.mp4`;
      await fs.mkdir(path.join(dir, "conversions", "sources"), { recursive: true });
      await fs.writeFile(path.join(dir, "conversions", "sources", name), "private source");
      const response = await get(["conversions", "sources", name]);
      expect(await response.text()).toBe("private source");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(store.getObject).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
