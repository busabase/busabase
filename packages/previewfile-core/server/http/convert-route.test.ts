import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConversionStorage } from "../converter/conversion-storage";
import type { ConversionSourceDecision, ResolveConversionSource } from "./conversion-source";
import { createConvertRoute } from "./convert-route";

const mockEnqueueConversion = vi.fn();
const mockWaitForConversionCompletion = vi.fn();

vi.mock("../queue/conversion-queue", () => ({
  generateConversionJobId: (seed: string, outputFormat: string) =>
    `conversion-${seed.slice(0, 12)}-${outputFormat}`,
  enqueueConversion: (...args: unknown[]) => mockEnqueueConversion(...args),
  waitForConversionCompletion: (...args: unknown[]) => mockWaitForConversionCompletion(...args),
}));

const OUTPUT_PATH = "/api/convert/pdf-file/conversions/output.pdf";

const allow = (
  overrides: Partial<{ fingerprint: { size: number; modifiedAt: string } | null }> = {},
) =>
  vi.fn<ResolveConversionSource>(async ({ fileUrl }) => ({
    ok: true,
    source: {
      fetchUrl: `https://files.example${fileUrl}`,
      cacheUrl: `https://files.example${fileUrl.split("?")[0]}`,
      fingerprint:
        "fingerprint" in overrides
          ? (overrides.fingerprint ?? null)
          : { size: 1024, modifiedAt: "2026-10-01T00:00:00.000Z" },
    },
  }));

const makeRequest = (body: unknown) =>
  new Request("https://host.example/api/convert", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBody = {
  fileUrl: "/files/deck.pptx?sig=abc",
  fileName: "deck.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const routeOptions = (resolveSource: ResolveConversionSource) => ({
  resolveSource,
  queueName: "test-document-conversion",
  cacheKeyPrefix: "test:conv-cache:",
  cacheVersion: "test-v1",
});

describe("createConvertRoute", () => {
  let storageDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // In-memory cache, local conversion storage under a temp dir.
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_CONNECTION_STRING", "");
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "convert-route-"));
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${storageDir}`);
    resetConversionStorage();
    await fs.mkdir(path.join(storageDir, "conversions"), { recursive: true });
    await fs.writeFile(path.join(storageDir, "conversions", "output.pdf"), "%PDF-1.4");

    mockEnqueueConversion.mockResolvedValue("enqueued-job");
    mockWaitForConversionCompletion.mockResolvedValue({
      success: true,
      outputUrl: OUTPUT_PATH,
      outputUri: "local://conversions/output.pdf",
      processingTime: 42,
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetConversionStorage();
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it("hands the worker the URL the host resolved, on the host's queue", async () => {
    const resolveSource = allow();
    const { POST } = createConvertRoute(routeOptions(resolveSource));

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, outputUrl: OUTPUT_PATH });
    expect(resolveSource).toHaveBeenCalledWith(
      expect.objectContaining({ fileUrl: "/files/deck.pptx?sig=abc", fileName: "deck.pptx" }),
    );
    const [jobData, , queueName] = mockEnqueueConversion.mock.calls[0] ?? [];
    expect(jobData).toMatchObject({ fileUrl: "https://files.example/files/deck.pptx?sig=abc" });
    expect(queueName).toBe("test-document-conversion");
    expect(mockWaitForConversionCompletion).toHaveBeenCalledWith(
      "enqueued-job",
      60_000,
      "test-document-conversion",
    );
  });

  it("never enqueues a source the host refuses", async () => {
    const refusal: ConversionSourceDecision = {
      ok: false,
      status: 403,
      error: "This file cannot be converted from its current location",
    };
    const { POST } = createConvertRoute(routeOptions(vi.fn(async () => refusal)));

    const response = await POST(
      makeRequest({ ...validBody, fileUrl: "http://169.254.169.254/latest/meta-data/" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: refusal.error });
    expect(mockEnqueueConversion).not.toHaveBeenCalled();
  });

  it.each(["success", "failure", "timeout", "unavailable"])(
    "queues only the staged read URL and cleans it up after %s",
    async (outcome) => {
      const cleanup = vi.fn(async () => {});
      const prepareFetch = vi.fn(async () => ({
        fetchUrl: "https://host.example/api/convert/pdf-file/conversions/sources/temporary-source",
        cleanup,
      }));
      const resolveSource: ResolveConversionSource = async () => ({
        ok: true,
        source: {
          fetchUrl: "https://host.example/api/drive/cloud-download?sig=private-original",
          cacheUrl: "https://host.example/private-source",
          fingerprint: null,
          prepareFetch,
        },
      });
      if (outcome === "failure") {
        mockWaitForConversionCompletion.mockResolvedValue({ success: false, error: "Unavailable" });
      }
      if (outcome === "timeout") mockWaitForConversionCompletion.mockResolvedValue(null);
      if (outcome === "unavailable") mockEnqueueConversion.mockResolvedValue(null);
      const { POST } = createConvertRoute(routeOptions(resolveSource));
      const response = await POST(
        new Request("https://host.example/api/convert", {
          method: "POST",
          body: JSON.stringify({
            ...validBody,
            sourceAuthorization: {
              Cookie: "private-cookie",
              Authorization: "Bearer private-token",
            },
          }),
          headers: { cookie: "private-cookie", authorization: "Bearer private-token" },
        }),
      );
      expect(response.status).toBe(
        outcome === "success"
          ? 200
          : outcome === "timeout"
            ? 504
            : outcome === "unavailable"
              ? 503
              : 500,
      );
      expect(prepareFetch).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      const job = mockEnqueueConversion.mock.calls[0]?.[0];
      expect(job.fileUrl).toContain("/conversions/sources/temporary-source");
      expect(JSON.stringify(job)).not.toMatch(
        /private-cookie|private-token|private-original|sourceAuthorization/,
      );
      expect(await response.text()).not.toMatch(/temporary-source|private-cookie|private-token/);
    },
  );

  it("rechecks the host's authorization before serving a cached conversion", async () => {
    let permitted = true;
    const prepareFetch = vi.fn(async () => ({
      fetchUrl: "https://host.example/staged",
      cleanup: vi.fn(async () => {}),
    }));
    const resolveSource: ResolveConversionSource = async () =>
      permitted
        ? {
            ok: true,
            source: {
              fetchUrl: "https://host.example/private-source",
              cacheUrl: "https://host.example/private-source",
              fingerprint: { size: 1024, modifiedAt: "2026-10-01T00:00:00.000Z" },
              prepareFetch,
            },
          }
        : { ok: false, status: 403, error: "Forbidden" };
    const { POST } = createConvertRoute(routeOptions(resolveSource));
    expect((await POST(makeRequest(validBody))).status).toBe(200);
    permitted = false;
    const second = await POST(makeRequest(validBody));
    expect(second.status).toBe(403);
    expect(mockEnqueueConversion).toHaveBeenCalledOnce();
    expect(prepareFetch).toHaveBeenCalledOnce();
  });

  it("rejects malformed requests before asking the host", async () => {
    const resolveSource = allow();
    const { POST } = createConvertRoute(routeOptions(resolveSource));

    const notJson = await POST(makeRequest("not json"));
    expect(notJson.status).toBe(400);

    const missingName = await POST(makeRequest({ ...validBody, fileName: "" }));
    expect(missingName.status).toBe(400);
    expect(await missingName.json()).toMatchObject({
      error: "Validation error",
      details: [expect.objectContaining({ field: "fileName" })],
    });

    const badUrl = await POST(makeRequest({ ...validBody, fileUrl: "not a url" }));
    expect(badUrl.status).toBe(400);

    expect(resolveSource).not.toHaveBeenCalled();
  });

  it("serves an unchanged file from the cache and reconverts a changed one", async () => {
    let fingerprint = { size: 1024, modifiedAt: "2026-10-01T00:00:00.000Z" };
    const resolveSource = vi.fn<ResolveConversionSource>(async () => ({
      ok: true,
      source: {
        fetchUrl: "https://files.example/deck.pptx?sig=1",
        cacheUrl: "https://files.example/deck.pptx",
        fingerprint,
      },
    }));
    const { POST } = createConvertRoute(routeOptions(resolveSource));

    await POST(makeRequest(validBody));
    const second = await POST(makeRequest(validBody));
    expect(await second.json()).toMatchObject({ cached: true, outputUrl: OUTPUT_PATH });
    expect(mockEnqueueConversion).toHaveBeenCalledTimes(1);

    fingerprint = { size: 2048, modifiedAt: "2026-10-02T00:00:00.000Z" };
    const third = await POST(makeRequest(validBody));
    expect(await third.json()).not.toHaveProperty("cached");
    expect(mockEnqueueConversion).toHaveBeenCalledTimes(2);
  });

  it("reconverts when the cached output file is gone", async () => {
    const { POST } = createConvertRoute(routeOptions(allow()));

    await POST(makeRequest(validBody));
    await fs.rm(path.join(storageDir, "conversions", "output.pdf"));
    await POST(makeRequest(validBody));

    expect(mockEnqueueConversion).toHaveBeenCalledTimes(2);
  });

  it("skips the cache when the host has no fingerprint", async () => {
    const { POST } = createConvertRoute(routeOptions(allow({ fingerprint: null })));

    await POST(makeRequest(validBody));
    const second = await POST(makeRequest(validBody));

    expect(await second.json()).not.toHaveProperty("cached");
    expect(mockEnqueueConversion).toHaveBeenCalledTimes(2);
  });

  it("maps queue outcomes to status codes", async () => {
    const { POST } = createConvertRoute(routeOptions(allow({ fingerprint: null })));

    mockEnqueueConversion.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(validBody))).status).toBe(503);

    mockWaitForConversionCompletion.mockResolvedValueOnce(null);
    expect((await POST(makeRequest(validBody))).status).toBe(504);

    mockWaitForConversionCompletion.mockResolvedValueOnce({ success: false, error: "corrupt" });
    const failed = await POST(makeRequest(validBody));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ success: false, error: "corrupt" });
  });

  it("lets the host read its own fields, flag a public source and present the output", async () => {
    const resolveSource = vi.fn<ResolveConversionSource>(async ({ body }) => ({
      ok: true,
      source: {
        fetchUrl: "https://third-party.example/deck.pptx?id=7",
        cacheUrl: "https://third-party.example/deck.pptx?id=7",
        fingerprint: { size: 1024, modifiedAt: "2026-10-01T00:00:00.000Z" },
        sourceFetch: "public",
        context: { shareLink: body.shareLink },
      },
    }));
    const presentOutput = vi.fn(
      async ({
        source,
        outputUri,
        cached,
      }: {
        source: { context?: unknown };
        outputUri: string;
        cached: boolean;
      }) =>
        `/share/${(source.context as { shareLink: string }).shareLink}/pdf?from=${outputUri}&cached=${cached}`,
    );
    const { POST } = createConvertRoute({ ...routeOptions(resolveSource), presentOutput });

    const fresh = await POST(makeRequest({ ...validBody, shareLink: "abc123" }));
    const cached = await POST(makeRequest({ ...validBody, shareLink: "abc123" }));

    expect(resolveSource.mock.calls[0]?.[0].body).toMatchObject({ shareLink: "abc123" });
    expect(mockEnqueueConversion.mock.calls[0]?.[0]).toMatchObject({ sourceFetch: "public" });
    expect(await fresh.json()).toMatchObject({
      outputUrl: "/share/abc123/pdf?from=local://conversions/output.pdf&cached=false",
    });
    expect(await cached.json()).toMatchObject({
      cached: true,
      outputUrl: "/share/abc123/pdf?from=local://conversions/output.pdf&cached=true",
    });
  });

  it("passes the host's refusal status through", async () => {
    const { POST } = createConvertRoute(
      routeOptions(
        vi.fn(async () => ({ ok: false as const, status: 401, error: "Password required" })),
      ),
    );

    const response = await POST(makeRequest(validBody));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Password required" });
  });
});
