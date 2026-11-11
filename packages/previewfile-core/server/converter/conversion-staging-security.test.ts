import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("openlib/storage", () => ({ createStorage: () => fixture.store }));

import { resetConversionStorage, stageConversionSource } from "./conversion-storage";

let server: Server;
let origin: string;
let publicStatus: number;
let directStatus: number;
let uploaded: string[];
let removed: string[];
let observedHeaders: Record<string, unknown>[];
let brokenProbe: boolean;
let directGetStatus: number;
let directBody: string;
let streamBody: boolean;
let stallBody: boolean;
let observedRequests: { method: string; path: string }[];
const R2_HOST = "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
const R2_AUTH_ERROR =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>';
const nativeFetch = globalThis.fetch;

beforeEach(async () => {
  publicStatus = 403;
  directStatus = 403;
  uploaded = [];
  removed = [];
  observedHeaders = [];
  brokenProbe = false;
  directGetStatus = 400;
  directBody = R2_AUTH_ERROR;
  streamBody = false;
  stallBody = false;
  observedRequests = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  server = createServer((request, response) => {
    observedHeaders.push(request.headers);
    observedRequests.push({ method: request.method ?? "", path: request.url ?? "" });
    if (brokenProbe) {
      request.socket.destroy();
      return;
    }
    if (request.method === "GET") {
      response.writeHead(directGetStatus, {
        "content-type": "application/xml",
        ...(streamBody ? {} : { "content-length": Buffer.byteLength(directBody) }),
        ...(directGetStatus === 302 ? { location: "/redirect-target" } : {}),
      });
      if (stallBody) {
        response.flushHeaders();
        return;
      }
      if (streamBody) response.write(directBody.slice(0, 30));
      response.end(streamBody ? directBody.slice(30) : directBody);
      return;
    }
    response.writeHead(request.url?.startsWith("/cdn/") ? publicStatus : directStatus).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected port");
  origin = `http://127.0.0.1:${address.port}`;
  fixture.store = {
    uploadFileToKey: async (_content: Buffer, key: string) => {
      uploaded.push(key);
      return { uri: `s3://private-bucket/${key}` };
    },
    generatePresignedUrl: async (key: string) =>
      `${origin}/private/${key}?X-Amz-Signature=private-sig`,
    getPublicUrl: (key: string) => `${origin}/cdn/${key}`,
    deleteObject: async (key: string) => {
      removed.push(key);
    },
  };
  vi.stubEnv(
    "PREVIEWFILE_STORAGE_URL",
    "s3://isolated-key:isolated-secret@fixture.test/private-bucket",
  );
  resetConversionStorage();
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetConversionStorage();
});

const stage = () =>
  stageConversionSource({
    content: Buffer.from("authorized source"),
    mimeType: "application/msword",
    baseUrl: origin,
  });

/** Keep native HTTP round-trips while routing R2-shaped test URLs to the fixture server. */
const useR2 = (virtualHost = false) => {
  vi.stubEnv(
    "PREVIEWFILE_STORAGE_URL",
    `r2://isolated-key:isolated-secret@${R2_HOST}/private-bucket`,
  );
  const store = fixture.store as {
    generatePresignedUrl: (key: string) => Promise<string>;
  };
  store.generatePresignedUrl = async (key) =>
    virtualHost
      ? `https://private-bucket.${R2_HOST}/${key}?X-Amz-Signature=private-sig`
      : `https://${R2_HOST}/private-bucket/${key}?X-Amz-Signature=private-sig`;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
    const requested = new URL(String(input));
    expect(options?.credentials).toBe("omit");
    expect(options?.redirect).toBe("error");
    expect(requested.search).toBe("");
    return nativeFetch(new URL(requested.pathname, origin), options);
  });
  directStatus = 400;
};

describe("remote staging requires private source storage", () => {
  it("allows a private presigned object while sending no user credentials in anonymous probes", async () => {
    const prepared = await stage();
    expect(prepared.fetchUrl).toContain("X-Amz-Signature=private-sig");
    expect(observedHeaders).toHaveLength(2);
    for (const headers of observedHeaders) {
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
    }
    expect(removed).toEqual([]);
    await prepared.cleanup();
    expect(removed).toEqual(uploaded);
  });

  it.each(["direct", "cdn", "ambiguous", "network"])(
    "rejects %s exposure or uncertainty and removes the staged bytes",
    async (mode) => {
      if (mode === "direct") directStatus = 200;
      if (mode === "cdn") publicStatus = 200;
      if (mode === "ambiguous") directStatus = 503;
      if (mode === "network") brokenProbe = true;
      await expect(stage()).rejects.toThrow("Could not stage source in private storage");
      expect(uploaded).toHaveLength(1);
      expect(removed).toEqual(uploaded);
    },
  );

  it.each([false, true])(
    "recognizes R2's exact missing-authorization XML after HEAD 400 (virtual host: %s)",
    async (virtualHost) => {
      useR2(virtualHost);
      const prepared = await stage();
      expect(prepared.fetchUrl).toContain("X-Amz-Signature=private-sig");
      expect(observedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET", "HEAD"]);
      expect(observedHeaders.every((headers) => !headers.cookie && !headers.authorization)).toBe(
        true,
      );
      expect(console.error).not.toHaveBeenCalled();
      await prepared.cleanup();
      expect(removed).toEqual(uploaded);
    },
  );

  it("checks the configured path-style R2 public URL independently of a virtual signed URL", async () => {
    useR2(true);
    (fixture.store as { getPublicUrl: (key: string) => string }).getPublicUrl = (key) =>
      `https://${R2_HOST}/private-bucket/${key}`;
    const prepared = await stage();
    expect(observedRequests.map(({ method }) => method)).toEqual(["HEAD", "GET", "HEAD", "GET"]);
    await prepared.cleanup();
  });

  it("continues rejecting a public CDN after the R2 error is recognized", async () => {
    useR2();
    publicStatus = 200;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "privacy-check",
      reason: "anonymous-access",
      status: 200,
    });
  });

  it.each([
    ["generic 400", "Bad request"],
    ["another R2 error", "<Error><Code>InvalidArgument</Code><Message>Other</Message></Error>"],
    ["malformed XML", "<Error><Code>InvalidArgument</Code><Message>Authorization</Message>"],
    ["embedded XML", `<html>${R2_AUTH_ERROR}</html>`],
    ["oversized body", `${R2_AUTH_ERROR}${" ".repeat(2_048)}`],
  ])("rejects %s and cleans up", async (_mode, body) => {
    useR2();
    directBody = body;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
  });

  it("bounds the streamed R2 error body even without a content length", async () => {
    useR2();
    streamBody = true;
    directBody = `${R2_AUTH_ERROR}${" ".repeat(2_048)}`;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "privacy-check",
      reason: "probe-body-too-large",
      status: 400,
    });
  });

  it("times out a stalled R2 error response and removes the source", async () => {
    useR2();
    stallBody = true;
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(100));
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "privacy-check",
      reason: "probe-request-failed",
      errorType: "TimeoutError",
      status: 400,
    });
  });

  it("cancels an anonymously readable GET without waiting for its body", async () => {
    useR2();
    directGetStatus = 200;
    stallBody = true;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "privacy-check",
      reason: "anonymous-access",
      status: 200,
    });
  });

  it.each([200, 206, 302, 503])("rejects GET %s after R2 HEAD 400", async (status) => {
    useR2();
    directGetStatus = status;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(removed).toEqual(uploaded);
    expect(observedRequests.some(({ path }) => path === "/redirect-target")).toBe(false);
  });

  it("does not interpret an arbitrary S3 host's 400 as a private R2 object", async () => {
    directStatus = 400;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(observedRequests.map(({ method }) => method)).toEqual(["HEAD"]);
    expect(removed).toEqual(uploaded);
  });

  it.each([
    ["different account", `https://${"f".repeat(32)}.r2.cloudflarestorage.com/private-bucket/`],
    ["different bucket", `https://${R2_HOST}/other-bucket/`],
    ["lookalike host", `https://${R2_HOST}.example.test/private-bucket/`],
  ])("rejects an R2 signed URL for a %s", async (_mode, prefix) => {
    useR2();
    (
      fixture.store as { generatePresignedUrl: (key: string) => Promise<string> }
    ).generatePresignedUrl = async (key) => `${prefix}${key}?X-Amz-Signature=private-sig`;
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(observedRequests.map(({ method }) => method)).toEqual(["HEAD"]);
    expect(removed).toEqual(uploaded);
  });

  it.each(["upload", "presign", "privacy-check"] as const)(
    "logs a safe diagnostic for a %s failure without source or credential details",
    async (phase) => {
      const sensitiveMessage =
        "SECRET-CREDENTIAL https://private.test/private-filename.doc?X-Amz-Signature=secret-signature private-source-content";
      const error = Object.assign(new Error(sensitiveMessage), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
        extra: sensitiveMessage,
      });
      if (phase === "upload") {
        (fixture.store as { uploadFileToKey: () => Promise<never> }).uploadFileToKey = async () => {
          throw error;
        };
      } else if (phase === "presign") {
        (fixture.store as { generatePresignedUrl: () => Promise<never> }).generatePresignedUrl =
          async () => {
            throw error;
          };
      } else {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
      }
      await expect(stage()).rejects.toThrow("Could not stage source in private storage");
      expect(console.error).toHaveBeenCalledWith(expect.any(String), {
        phase,
        reason: phase === "privacy-check" ? "probe-request-failed" : "operation-failed",
        errorType: "Unknown",
        status: 403,
        providerCode: "AccessDenied",
      });
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).not.toContain("SECRET-CREDENTIAL");
      expect(logged).not.toContain("private-filename");
      expect(logged).not.toContain("secret-signature");
      expect(logged).not.toContain("private-source-content");
    },
  );

  it("logs cleanup failure safely without masking the staging failure", async () => {
    directStatus = 503;
    (fixture.store as { deleteObject: () => Promise<never> }).deleteObject = async () => {
      throw Object.assign(new Error("secret cleanup URL"), {
        name: "TypeError",
        code: "secret arbitrary provider code",
      });
    };
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "privacy-check",
      reason: "unexpected-probe-response",
      status: 503,
    });
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), {
      phase: "cleanup",
      reason: "operation-failed",
      errorType: "TypeError",
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("secret");
  });

  it("retains the known R2 Unauthorized provider code without logging its raw error", async () => {
    (fixture.store as { uploadFileToKey: () => Promise<never> }).uploadFileToKey = async () => {
      throw Object.assign(new Error("secret R2 configuration"), {
        name: "Unauthorized",
        $metadata: { httpStatusCode: 401 },
      });
    };
    await expect(stage()).rejects.toThrow("Could not stage source in private storage");
    expect(console.error).toHaveBeenCalledWith(expect.any(String), {
      phase: "upload",
      reason: "operation-failed",
      errorType: "Unknown",
      status: 401,
      providerCode: "Unauthorized",
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});
