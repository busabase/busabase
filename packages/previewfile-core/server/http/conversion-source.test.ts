import { describe, expect, it, vi } from "vitest";
import {
  fingerprintFromHeaders,
  generateConversionCacheKey,
  resolveStoredSource,
  storageKeyFromUrl,
  storageKeyFromUrlPath,
  stripUrlQuery,
} from "./conversion-source";

const baseIdentity = {
  version: "test-conversion-cache-v1",
  normalizedFileUrl: "https://files.example/conversions/deck.pptx",
  fileName: "deck.pptx",
  outputFormat: "pdf" as const,
  source: { size: 1024, modifiedAt: "2026-06-10T10:00:00.000Z" },
};

describe("generateConversionCacheKey", () => {
  it("is stable for the same identity", () => {
    expect(generateConversionCacheKey(baseIdentity)).toBe(
      generateConversionCacheKey({ ...baseIdentity }),
    );
  });

  it.each([
    [
      "source modifiedAt",
      { source: { ...baseIdentity.source, modifiedAt: "2026-06-10T10:01:00.000Z" } },
    ],
    ["source size", { source: { ...baseIdentity.source, size: 2048 } }],
    ["host version", { version: "other-host-v1" }],
    ["output format", { outputFormat: "html" as const }],
  ])("changes when the %s changes", (_label, change) => {
    expect(generateConversionCacheKey({ ...baseIdentity, ...change })).not.toBe(
      generateConversionCacheKey(baseIdentity),
    );
  });

  it("keeps the keys Buda's cache was written with", () => {
    // Golden value from Buda's former in-route generateBudaConversionCacheKey,
    // so entries cached before the move into this package stay valid.
    expect(
      generateConversionCacheKey({ ...baseIdentity, version: "buda-conversion-cache-v2" }),
    ).toBe("d30c003a0ddf4aa886bc9af77d2fad692d5baf90eeab65e28037d7202a1cd538");
  });
});

describe("stripUrlQuery", () => {
  it("drops signature params so re-signed URLs share one identity", () => {
    expect(
      stripUrlQuery("https://bucket.example/conversions/deck.pptx?X-Amz-Date=1&X-Amz-Signature=a"),
    ).toBe(
      stripUrlQuery("https://bucket.example/conversions/deck.pptx?X-Amz-Date=2&X-Amz-Signature=b"),
    );
    expect(stripUrlQuery("https://bucket.example/a/b.docx?sig=1")).toBe(
      "https://bucket.example/a/b.docx",
    );
  });
});

describe("storageKeyFromUrlPath", () => {
  it("decodes the key a public URL path points at", () => {
    expect(storageKeyFromUrlPath("spaces/sp_1/deck.pptx")).toBe("spaces/sp_1/deck.pptx");
    expect(storageKeyFromUrlPath("files/%E5%91%A8%E6%8A%A5.pptx")).toBe("files/周报.pptx");
  });

  it.each([
    ["an encoded-slash escape", "files/..%2F..%2Fsecret"],
    ["a dot segment", "files/./deck.pptx"],
    ["a backslash", "files\\..\\secret"],
    ["malformed escapes", "files/%E5%91.pptx"],
    ["nothing", ""],
  ])("refuses %s", (_label, path) => {
    expect(storageKeyFromUrlPath(path)).toBeNull();
  });
});

describe("resolveStoredSource", () => {
  const input = {
    key: "spaces/sp_1/deck.pptx",
    fetchUrl: "https://files.example/spaces/sp_1/deck.pptx?sig=1",
    cacheUrl: "https://files.example/spaces/sp_1/deck.pptx",
  };

  it("fingerprints the object from the storage adapter", async () => {
    const getObjectMetadata = vi.fn(async () => ({
      size: 4096,
      lastModified: new Date("2026-10-01T08:00:00.000Z"),
    }));

    await expect(resolveStoredSource({ ...input, getObjectMetadata })).resolves.toEqual({
      ok: true,
      source: {
        fetchUrl: input.fetchUrl,
        cacheUrl: input.cacheUrl,
        fingerprint: { size: 4096, modifiedAt: "2026-10-01T08:00:00.000Z" },
      },
    });
    expect(getObjectMetadata).toHaveBeenCalledWith("spaces/sp_1/deck.pptx");
  });

  it("answers 404 for an object that is not in storage", async () => {
    await expect(
      resolveStoredSource({ ...input, getObjectMetadata: async () => null }),
    ).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("converts uncached when storage cannot say", async () => {
    await expect(
      resolveStoredSource({
        ...input,
        getObjectMetadata: async () => {
          throw new Error("storage unavailable");
        },
      }),
    ).resolves.toMatchObject({ ok: true, source: { fingerprint: null } });
  });
});

describe("storageKeyFromUrl", () => {
  const base = "https://app.example";

  it("reads the key from a public storage URL", async () => {
    const publicUrl = (key: string) => `https://cdn.example/${key}`;
    expect(await storageKeyFromUrl(new URL("https://cdn.example/a/b.pptx"), publicUrl, base)).toBe(
      "a/b.pptx",
    );
    expect(
      await storageKeyFromUrl(new URL("https://evil.example/a/b.pptx"), publicUrl, base),
    ).toBeNull();
  });

  it("reads the key from a presigned URL, ignoring the signature", async () => {
    const presigned = async (key: string) =>
      `https://s3.example/bucket/${key}?X-Amz-Signature=probe`;
    expect(
      await storageKeyFromUrl(
        new URL("https://s3.example/bucket/a/deck.pptx?X-Amz-Signature=x"),
        presigned,
        base,
      ),
    ).toBe("a/deck.pptx");
    expect(
      await storageKeyFromUrl(new URL("https://s3.example/other/deck.pptx"), presigned, base),
    ).toBeNull();
  });

  it("resolves a relative storage URL against the app and refuses escapes", async () => {
    const devProxy = (key: string) => `/api/dev/attachment/${key}`;
    expect(
      await storageKeyFromUrl(new URL(`${base}/api/dev/attachment/x/y.doc`), devProxy, base),
    ).toBe("x/y.doc");
    expect(
      await storageKeyFromUrl(
        new URL(`${base}/api/dev/attachment/x/..%2F..%2Fsecret`),
        devProxy,
        base,
      ),
    ).toBeNull();
  });
});

describe("fingerprintFromHeaders", () => {
  it("reads size and last-modified, or gives up when either is missing", () => {
    expect(
      fingerprintFromHeaders(
        new Headers({ "content-length": "4096", "last-modified": "Wed, 01 Oct 2026 08:00:00 GMT" }),
      ),
    ).toEqual({ size: 4096, modifiedAt: "2026-10-01T08:00:00.000Z" });
    expect(fingerprintFromHeaders(new Headers({ "content-length": "4096" }))).toBeNull();
  });

  it("versions a file by its ETag when the server sends no Last-Modified", () => {
    expect(
      fingerprintFromHeaders(new Headers({ "content-length": "68822", etag: '"ecf34ce8"' })),
    ).toEqual({ size: 68822, modifiedAt: 'etag:"ecf34ce8"' });
    // Last-Modified still wins when both are there.
    expect(
      fingerprintFromHeaders(
        new Headers({
          "content-length": "1",
          "last-modified": "Wed, 01 Oct 2026 08:00:00 GMT",
          etag: '"x"',
        }),
      ),
    ).toEqual({ size: 1, modifiedAt: "2026-10-01T08:00:00.000Z" });
  });
});
