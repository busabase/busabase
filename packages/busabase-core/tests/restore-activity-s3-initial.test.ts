import { createServer, type Server } from "node:http";
import { resetStorage } from "openlib/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRestoreAutomationBlocked } from "../src/domains/dump/logic/restore-activity";

describe("restore guard against a genuinely fresh S3-compatible HTTP store", () => {
  let server: Server | undefined;
  afterEach(async () => {
    resetStorage();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
  });
  const setup = async (autoCreate: boolean, forbidden = false) => {
    let exists = false;
    const methods: string[] = [];
    server = createServer((request, response) => {
      methods.push(request.method ?? "");
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "HEAD") {
        response.writeHead(forbidden ? 403 : exists ? 200 : 404).end();
        return;
      }
      if (request.method === "PUT") {
        exists = true;
        request.resume();
        response.writeHead(200).end();
        return;
      }
      const code = !exists ? "NoSuchBucket" : "NoSuchKey";
      if (url.searchParams.has("list-type") && exists) {
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(
          '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>guard-fresh</Name><IsTruncated>false</IsTruncated></ListBucketResult>',
        );
        return;
      }
      response.writeHead(404, { "content-type": "application/xml" });
      response.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test address");
    resetStorage();
    vi.stubEnv(
      "STORAGE_URL",
      `minio://test-key:test-secret@127.0.0.1:${address.port}/guard-fresh?ssl=false&auto_create=${autoCreate}`,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    return methods;
  };
  it("initializes only an explicitly auto-created bucket, then sees no restore marker", async () => {
    const methods = await setup(true);
    expect(await isRestoreAutomationBlocked("space")).toBe(false);
    expect(methods).toEqual(["GET", "HEAD", "PUT", "GET", "GET"]);
  });
  it("keeps a missing non-auto-created bucket blocked without creating it", async () => {
    const methods = await setup(false);
    expect(await isRestoreAutomationBlocked("space")).toBe(true);
    expect(methods).toEqual(["GET", "GET"]);
  });
  it("keeps forbidden bucket initialization blocked and never issues a PUT", async () => {
    const methods = await setup(true, true);
    expect(await isRestoreAutomationBlocked("space")).toBe(true);
    expect(methods).toEqual(["GET", "HEAD"]);
  });
});
