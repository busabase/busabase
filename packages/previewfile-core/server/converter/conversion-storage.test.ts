import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalConversionRootDir,
  readConversionOutput,
  resetConversionStorage,
  resolveConversionStorageUrl,
  stageConversionSource,
} from "./conversion-storage";

describe("resolveConversionStorageUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const parsedRoot = (url: string) => new URL(url).pathname;

  it("defaults to .data/conversions under the working directory, as an absolute path", () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "");
    vi.stubEnv("BUDA_DRIVE_URL", "");

    const url = resolveConversionStorageUrl();

    // What openlib reads as the root: the URL's pathname. A relative
    // `local://.data/conversions` used to parse as host ".data" + "/conversions".
    expect(parsedRoot(url)).toBe(path.resolve(process.cwd(), ".data/conversions"));
    expect(new URL(url).searchParams.get("base_url")).toBe("/api/convert/pdf-file");
    expect(getLocalConversionRootDir()).toBe(path.resolve(process.cwd(), ".data/conversions"));
  });

  it.each([
    ["local://.data/buda-drive", ".data/buda-drive"],
    ["local:.data/out", ".data/out"],
  ])("resolves a relative %s against the working directory", (configured, relative) => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", configured);
    expect(parsedRoot(resolveConversionStorageUrl())).toBe(path.resolve(process.cwd(), relative));
    expect(getLocalConversionRootDir()).toBe(path.resolve(process.cwd(), relative));
  });

  it("keeps an absolute root and an explicit base_url", () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "local:///srv/conversions?base_url=/files");
    const url = resolveConversionStorageUrl();
    expect(parsedRoot(url)).toBe("/srv/conversions");
    expect(new URL(url).searchParams.get("base_url")).toBe("/files");
  });

  it("leaves remote storage alone", () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "s3://key:secret@s3.example/bucket");
    expect(resolveConversionStorageUrl()).toBe("s3://key:secret@s3.example/bucket");
    expect(getLocalConversionRootDir()).toBeNull();
  });
});

describe("readConversionOutput", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConversionStorage();
  });

  it("reads an output by the URI the converter returned, or null once it is gone", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "conversion-output-"));
    try {
      vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${root}`);
      resetConversionStorage();
      mkdirSync(path.join(root, "conversions"), { recursive: true });
      writeFileSync(path.join(root, "conversions", "abc.pdf"), "%PDF-1.4 test");

      expect((await readConversionOutput("local://conversions/abc.pdf"))?.toString()).toBe(
        "%PDF-1.4 test",
      );
      expect(await readConversionOutput("local://conversions/missing.pdf")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stages an opaque source with a safe extension, bounded expiry and explicit cleanup", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "conversion-staging-"));
    try {
      vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${root}`);
      resetConversionStorage();
      const startedAt = Date.now();
      const prepared = await stageConversionSource({
        content: Buffer.from("private video bytes"),
        mimeType: "video/mp4",
        baseUrl: "https://host.example",
        filename: "../../private-user-file.MP4",
        ttlSeconds: 20 * 24 * 60 * 60,
      });
      const url = new URL(prepared.fetchUrl);
      expect(url.origin).toBe("https://host.example");
      expect(url.pathname).toMatch(/\/conversions\/sources\/\d{13}-[a-f0-9-]{36}\.mp4$/);
      expect(prepared.fetchUrl).not.toContain("private-user-file");
      const name = path.basename(url.pathname);
      const expiresAt = Number(name.slice(0, 13));
      expect(expiresAt).toBeGreaterThanOrEqual(startedAt + 7 * 24 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
      expect(await readConversionOutput(`local://conversions/sources/${name}`)).toEqual(
        Buffer.from("private video bytes"),
      );
      await prepared.cleanup();
      expect(await readConversionOutput(`local://conversions/sources/${name}`)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
