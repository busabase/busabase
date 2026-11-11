import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentConverter } from "./document-converter";

let converter: DocumentConverter;
let server: Server;
let directory: string;
let origin: string;
let redirectedReads = 0;
let observedHeaders: Record<string, unknown>;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "conversion-download-"));
  redirectedReads = 0;
  observedHeaders = {};
  converter = new DocumentConverter({ tempDirectory: directory });
  server = createServer((req, res) => {
    if (req.url?.startsWith("/redirect")) {
      res.writeHead(302, { Location: `${origin}/unexpected-target` }).end();
    } else if (req.url === "/unexpected-target") {
      redirectedReads++;
      res.writeHead(200).end("unexpected secret");
    } else {
      observedHeaders = req.headers;
      res.writeHead(200).end("authorized source bytes");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await converter.shutdown();
  await rm(directory, { recursive: true, force: true });
});

const download = (url: string) =>
  (
    converter as unknown as { downloadFile(url: string, destination: string): Promise<void> }
  ).downloadFile(url, path.join(directory, "source.doc"));

describe("authorized conversion source download over real HTTP", () => {
  it("reads staged bytes without any browser session header", async () => {
    await download(`${origin}/source`);
    expect((await readFile(path.join(directory, "source.doc"))).toString()).toBe(
      "authorized source bytes",
    );
    expect(observedHeaders.cookie).toBeUndefined();
    expect(observedHeaders.authorization).toBeUndefined();
  });

  it("refuses redirects and never includes a private capability in its error", async () => {
    const capability = "private-staged-capability";
    await expect(download(`${origin}/redirect?source=${capability}`)).rejects.toThrow();
    expect(redirectedReads).toBe(0);
    try {
      await download(`${origin}/redirect?source=${capability}`);
    } catch (error) {
      expect((error as Error).message).not.toContain(capability);
      expect((error as Error).message).not.toContain(origin);
    }
  });
});
