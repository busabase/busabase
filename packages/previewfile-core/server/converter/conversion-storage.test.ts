import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversionFileRoute } from "../http/conversion-file-route";
import {
  configurePublicConversionStorage,
  getLocalConversionRootDir,
  getLocalPublicConversionRootDir,
  getPublicConversionStorage,
  privateConversionOutputExists,
  publicConversionOutputKey,
  readConversionOutput,
  resetConversionStorage,
  resolveConversionStorageUrl,
  stageConversionSource,
  uploadPrivateConversionOutput,
} from "./conversion-storage";

describe("resolveConversionStorageUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    configurePublicConversionStorage();
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

  it("uses the host's shared fallback only for public derivatives", () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "");
    vi.stubEnv("BUDA_DRIVE_URL", "");
    configurePublicConversionStorage("s3://key:secret@s3.example/bucket");

    expect(getLocalPublicConversionRootDir()).toBeNull();
    expect(getLocalConversionRootDir()).toBe(path.resolve(process.cwd(), ".data/conversions"));
    expect(getPublicConversionStorage().getPublicUrl("conversions/test.pdf")).toContain(
      "s3.example",
    );
  });

  it("keeps an explicit conversion storage override ahead of the shared fallback", () => {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", "local:///srv/dedicated");
    configurePublicConversionStorage("s3://key:secret@s3.example/bucket");
    expect(getLocalPublicConversionRootDir()).toBe("/srv/dedicated");
    expect(getLocalConversionRootDir()).toBe("/srv/dedicated");
  });

  it("only recognizes generated public output keys", () => {
    const key = `conversions/${"a".repeat(64)}.pdf`;
    expect(publicConversionOutputKey(`s3://bucket/${key}`)).toBe(key);
    expect(publicConversionOutputKey(`local://${key}`)).toBe(key);
    for (const invalid of [
      "private-conversions/12345678-1234-1234-1234-123456789abc.pdf",
      "conversions/sources/source.pdf",
      "conversions/../secret.pdf",
      "conversions/file.pdf",
      `${key}?signature=secret`,
    ]) {
      expect(publicConversionOutputKey(invalid)).toBeNull();
    }
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

it("writes private derivatives outside every public local conversion-file path", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "private-conversion-"));
  try {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${root}`);
    resetConversionStorage();
    const output = await uploadPrivateConversionOutput({
      content: Buffer.from("%PDF-private-result"),
      format: "pdf",
    });
    expect(await privateConversionOutputExists(output.uri)).toBe(true);
    expect(await readConversionOutput(output.uri)).toEqual(Buffer.from("%PDF-private-result"));
    const { GET } = createConversionFileRoute();
    const key = output.uri.slice("local://".length).split("/");
    for (const routeKey of [key, ["conversions", "..", ...key]]) {
      const response = await GET(new Request("https://host.test/api/convert/pdf-file/hidden"), {
        params: Promise.resolve({ key: routeKey }),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("PDF-private-result");
    }
  } finally {
    resetConversionStorage();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it("fails closed when a custom local public route could expose the private key", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "private-conversion-custom-route-"));
  try {
    vi.stubEnv("PREVIEWFILE_STORAGE_URL", `local://${root}?base_url=/unbounded-public-files`);
    resetConversionStorage();
    await expect(
      uploadPrivateConversionOutput({ content: Buffer.from("%PDF-private"), format: "pdf" }),
    ).rejects.toThrow("Could not store conversion output privately");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(path.join(root, "private-conversions"))).toEqual([]);
  } finally {
    resetConversionStorage();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
