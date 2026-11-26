import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConversionFileRoute } from "../http/conversion-file-route";
import {
  privateConversionOutputExists,
  readConversionOutput,
  resetConversionStorage,
} from "./conversion-storage";
import { DocumentConverter } from "./document-converter";

let root: string;
let server: Server;
let converter: DocumentConverter;
let origin: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "private-office-output-"));
  vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${root}/storage`);
  resetConversionStorage();
  server = createServer((_req, res) =>
    res
      .writeHead(200, { "content-type": "application/rtf" })
      .end("{\\rtf1\\ansi Privacy-bound Office preview.}"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  converter = new DocumentConverter({ tempDirectory: root, conversionTimeout: 30000 });
});
afterEach(async () => {
  await converter?.shutdown();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  resetConversionStorage();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
describe.skipIf(process.env.VITEST_SKIP_LIBREOFFICE_INTEGRATION === "true")(
  "real LibreOffice private output",
  () => {
    it("creates a PDF directly in private storage and never creates a public hash copy", async () => {
      const result = await converter.convert({
        fileUrl: `${origin}/document.rtf`,
        fileName: "document.rtf",
        mimeType: "application/rtf",
        outputFormat: "pdf",
        privateOutput: true,
      });
      expect(result.success).toBe(true);
      expect(result.outputUri).toMatch(/^local:\/\/private-conversions\//);
      const output = await readConversionOutput(result.outputUri!);
      expect(output?.subarray(0, 5).toString()).toBe("%PDF-");
      expect(await privateConversionOutputExists(result.outputUri!)).toBe(true);
      expect(await readdir(path.join(root, "storage"))).toEqual(["private-conversions"]);
      const { GET } = createConversionFileRoute();
      const response = await GET(new Request(`https://host.test${result.outputUrl}`), {
        params: Promise.resolve({ key: result.outputUri!.slice("local://".length).split("/") }),
      });
      expect(response.status).toBe(403);
    }, 45000);
  },
);
