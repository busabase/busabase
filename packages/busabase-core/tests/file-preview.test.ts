import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";

const mocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  readSource: vi.fn(),
  resolveKind: vi.fn(),
}));

vi.mock("openlib/cache", () => ({ cache: Promise.resolve(null) }));
vi.mock("openlib/storage", () => ({ storage: { getObject: mocks.getObject } }));
vi.mock("../src/domains/filetree/handlers", () => ({
  readDriveFilePreviewSource: mocks.readSource,
  resolveFileTreeKind: mocks.resolveKind,
}));

import {
  getFilePreviewConfiguration,
  prepareDriveFilePreview,
  uploadToPreviewFile,
} from "../src/domains/filetree/logic/file-preview";

const runtimeConfig = (apiKey = "preview-key") => ({
  provider: "previewfile" as const,
  apiKey,
  baseUrl: "https://previewfile.dev",
  maxFileSizeBytes: 50 * 1024 * 1024,
  sessionTtlMinutes: 60,
  credentialSource: "environment" as const,
  vaultEncryptionConfigured: null,
});

const source = (contentHash = "hash-a", sizeBytes = 4) => ({
  nodeId: "drive-a",
  path: "brief.docx",
  assetId: "asset-a",
  storageKey: "storage-a",
  fileName: "brief.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes,
  contentHash,
});

describe("PreviewFile Drive preparation", () => {
  beforeEach(() => {
    mocks.getObject.mockReset().mockResolvedValue(Buffer.from("file"));
    mocks.resolveKind.mockReset().mockResolvedValue({ type: "drive" });
    mocks.readSource.mockReset().mockResolvedValue(source());
  });

  it("reports credential presence without returning the credential", async () => {
    const configured = await runWithBusabaseContext({ filePreview: runtimeConfig() }, async () =>
      getFilePreviewConfiguration(),
    );
    const missing = await runWithBusabaseContext({ filePreview: runtimeConfig("") }, async () =>
      getFilePreviewConfiguration(),
    );

    expect(configured).toMatchObject({ credentialConfigured: true });
    expect(missing).toMatchObject({ credentialConfigured: false });
    expect(JSON.stringify(configured)).not.toContain("preview-key");
  });

  it("sends the documented multipart fields and API-key header", async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.headers).toEqual({ "x-api-key": "preview-key" });
      expect(form.get("ttlMinutes")).toBe("60");
      expect(form.get("noDownload")).toBe("true");
      expect(form.get("oneTime")).toBe("false");
      expect((form.get("file") as File).name).toBe("brief.docx");
      return Response.json({
        success: true,
        data: {
          previewUrl: "https://previewfile.dev/preview/session-a",
          expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
    });

    const result = await uploadToPreviewFile(
      { ...source(), bytes: Buffer.from("file"), contentHash: "hash-a" },
      runtimeConfig(),
      fetchMock,
    );

    expect(result.result).toMatchObject({ state: "ready", provider: "previewfile" });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://previewfile.dev/api/v1/upload"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects a preview URL from another origin", async () => {
    const result = await uploadToPreviewFile(
      { ...source(), bytes: Buffer.from("file"), contentHash: "hash-a" },
      runtimeConfig(),
      vi.fn(async () =>
        Response.json({
          success: true,
          data: {
            previewUrl: "https://attacker.example/preview/session-a",
            expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
        }),
      ),
    );

    expect(result.result).toEqual({
      state: "unavailable",
      provider: "previewfile",
      reason: "invalid_response",
      retryable: true,
    });
  });

  it.each([
    [401, "authentication_failed", false],
    [415, "unsupported", false],
    [429, "rate_limited", true],
    [503, "service_unavailable", true],
  ] as const)("maps upstream HTTP %s to %s", async (status, reason, retryable) => {
    const result = await uploadToPreviewFile(
      { ...source(), bytes: Buffer.from("file"), contentHash: "hash-a" },
      runtimeConfig(),
      vi.fn(async () => new Response(null, { status })),
    );

    expect(result.result).toEqual({
      state: "unavailable",
      provider: "previewfile",
      reason,
      retryable,
    });
  });

  it("maps request aborts to a retryable timeout", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const result = await uploadToPreviewFile(
      { ...source(), bytes: Buffer.from("file"), contentHash: "hash-a" },
      runtimeConfig(),
      vi.fn(async () => {
        throw timeout;
      }),
    );

    expect(result.result).toMatchObject({ reason: "timeout", retryable: true });
  });

  it("rejects oversized files before loading object bytes", async () => {
    mocks.readSource.mockResolvedValue(source("large", 51 * 1024 * 1024));
    const fetchMock = vi.fn();
    const result = await runWithBusabaseContext({ filePreview: runtimeConfig() }, () =>
      prepareDriveFilePreview({ nodeId: "drive-a", filePath: "brief.docx" }, { fetch: fetchMock }),
    );

    expect(result).toMatchObject({ state: "unavailable", reason: "file_too_large" });
    expect(mocks.getObject).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades a missing credential to the built-in preview without resolving the Drive", async () => {
    const result = await runWithBusabaseContext({ filePreview: runtimeConfig("") }, () =>
      prepareDriveFilePreview({ nodeId: "drive-a", filePath: "brief.docx" }),
    );

    // Flipping the provider on before saving the key is a normal step of the OSS
    // setup, and Cloud can be left half-configured by mistake. Neither should
    // replace every Drive file with an error card.
    expect(result).toEqual({ state: "builtin", provider: "builtin" });
    expect(mocks.resolveKind).not.toHaveBeenCalled();
  });

  it.each([
    ["a Markdown file", { path: "README.md", mimeType: "text/markdown" }],
    ["a source file", { path: "src/index.ts", mimeType: "text/plain" }],
    ["an image", { path: "logo.png", mimeType: "image/png" }],
    ["a PDF", { path: "report.pdf", mimeType: "application/pdf" }],
    ["a video", { path: "clip.mp4", mimeType: "video/mp4" }],
  ])("keeps %s on the built-in preview instead of uploading it", async (_label, overrides) => {
    mocks.readSource.mockResolvedValue({ ...source(), ...overrides });
    const fetchMock = vi.fn();

    const result = await runWithBusabaseContext({ filePreview: runtimeConfig() }, () =>
      prepareDriveFilePreview(
        { nodeId: "drive-a", filePath: overrides.path },
        { fetch: fetchMock },
      ),
    );

    expect(result).toEqual({ state: "builtin", provider: "builtin" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it.each([
    [
      "DOCX",
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["ZIP", "bundle.zip", "application/zip"],
    ["PSD", "cover.psd", "image/vnd.adobe.photoshop"],
    ["EPUB", "book.epub", "application/epub+zip"],
  ])("escalates %s to the provider", async (_label, path, mimeType) => {
    // A distinct asset per case: the session cache is keyed by content, so
    // reusing one hash here would make the second case a cache hit.
    mocks.readSource.mockResolvedValue({
      ...source(`hash-${path}`),
      assetId: `asset-${path}`,
      path,
      mimeType,
    });
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          previewUrl: "https://previewfile.dev/preview/session-rich",
          expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }),
    );

    const result = await runWithBusabaseContext({ filePreview: runtimeConfig() }, () =>
      prepareDriveFilePreview({ nodeId: "drive-a", filePath: path }, { fetch: fetchMock }),
    );

    expect(result).toMatchObject({ state: "ready", provider: "previewfile" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefers the built-in preview over the size limit for natively playable media", async () => {
    mocks.readSource.mockResolvedValue({
      ...source("hash-video", 400 * 1024 * 1024),
      path: "clip.mp4",
      mimeType: "video/mp4",
    });

    // A large video the browser streams natively must not be reported as "too
    // large to preview" — it never needed the provider in the first place.
    const result = await runWithBusabaseContext({ filePreview: runtimeConfig() }, () =>
      prepareDriveFilePreview({ nodeId: "drive-a", filePath: "clip.mp4" }, { fetch: vi.fn() }),
    );

    expect(result).toEqual({ state: "builtin", provider: "builtin" });
  });

  it("degrades an invalid provider configuration to the built-in preview", async () => {
    const fetchMock = vi.fn();
    const result = await runWithBusabaseContext(
      {
        filePreview: {
          ...runtimeConfig(),
          configurationError: "PREVIEWFILE_BASE_URL must use HTTPS",
        },
      },
      () =>
        prepareDriveFilePreview(
          { nodeId: "drive-a", filePath: "brief.docx" },
          { fetch: fetchMock },
        ),
    );

    // A misconfigured host keeps working through the built-in preview instead of
    // failing every file, and never reaches the provider with a config Busabase
    // could not validate.
    expect(result).toEqual({ state: "builtin", provider: "builtin" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.resolveKind).not.toHaveBeenCalled();
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it("still reports an invalid configuration through the settings surface", async () => {
    const config = await runWithBusabaseContext(
      {
        filePreview: {
          ...runtimeConfig(),
          configurationError: "PREVIEWFILE_BASE_URL must use HTTPS",
        },
      },
      async () => getFilePreviewConfiguration(),
    );

    expect(config).toMatchObject({ status: "invalid_configuration" });
  });

  it("bounds the process-local session cache without dropping the recent entries", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        data: {
          previewUrl: "https://previewfile.dev/preview/session-bulk",
          expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }),
    );
    const prepareFile = (index: number) => {
      mocks.readSource.mockResolvedValue({
        ...source(`hash-bulk-${index}`),
        assetId: `asset-bulk-${index}`,
        path: `bulk-${index}.docx`,
      });
      return runWithBusabaseContext({ spaceId: "space-bulk", filePreview: runtimeConfig() }, () =>
        prepareDriveFilePreview(
          { nodeId: "drive-a", filePath: `bulk-${index}.docx` },
          { fetch: fetchMock },
        ),
      );
    };

    for (let index = 0; index < 600; index += 1) await prepareFile(index);
    expect(fetchMock).toHaveBeenCalledTimes(600);

    // The newest session is still served from memory…
    await prepareFile(599);
    expect(fetchMock).toHaveBeenCalledTimes(600);

    // …while the oldest was evicted by the cap instead of being kept forever,
    // so it is minted again on demand.
    await prepareFile(0);
    expect(fetchMock).toHaveBeenCalledTimes(601);
  });

  it("singleflights concurrent uploads and reuses the content cache", async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();
      return Response.json({
        success: true,
        data: {
          previewUrl: "https://previewfile.dev/preview/session-cached",
          expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
    });
    const prepare = () =>
      runWithBusabaseContext({ spaceId: "space-cache", filePreview: runtimeConfig() }, () =>
        prepareDriveFilePreview(
          { nodeId: "drive-a", filePath: "brief.docx" },
          { fetch: fetchMock },
        ),
      );

    const [first, second] = await Promise.all([prepare(), prepare()]);
    const third = await prepare();

    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.getObject).toHaveBeenCalledTimes(1);

    await runWithBusabaseContext(
      { spaceId: "space-cache", filePreview: runtimeConfig("rotated-key") },
      () =>
        prepareDriveFilePreview(
          { nodeId: "drive-a", filePath: "brief.docx" },
          { fetch: fetchMock },
        ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    mocks.readSource.mockResolvedValue(source("hash-b"));
    await runWithBusabaseContext({ spaceId: "space-cache", filePreview: runtimeConfig() }, () =>
      prepareDriveFilePreview({ nodeId: "drive-a", filePath: "brief.docx" }, { fetch: fetchMock }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
