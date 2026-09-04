import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QR_DEFAULT_SIZE, renderQrAscii, safeQrOutputPath, writeQrPng } from "./qrcode-command";

/** Query params, mixed case, and pre-encoded characters — the mangle-prone bits. */
const URL_UNDER_TEST = "https://busabase.com/device?user_code=ABCD-2345&next=%2Fdashboard+x";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "busabase-qr-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("writeQrPng", () => {
  it("writes a PNG that decodes back to the byte-identical URL", async () => {
    const file = join(dir, "qr.png");
    await writeQrPng(URL_UNDER_TEST, file, QR_DEFAULT_SIZE);

    const png = PNG.sync.read(await readFile(file));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(URL_UNDER_TEST);
  });

  it("rejects sizes outside the scannable bounds", async () => {
    await expect(writeQrPng(URL_UNDER_TEST, join(dir, "x.png"), 16)).rejects.toThrow("--size");
    await expect(writeQrPng(URL_UNDER_TEST, join(dir, "x.png"), 4096)).rejects.toThrow("--size");
  });
});

describe("renderQrAscii", () => {
  it("renders a non-trivial terminal QR code", async () => {
    const ascii = await renderQrAscii(URL_UNDER_TEST);
    expect(ascii.length).toBeGreaterThan(100);
    expect(ascii).toContain("\n");
  });
});

describe("safeQrOutputPath", () => {
  it("accepts paths under the temp dir and the working directory", () => {
    expect(safeQrOutputPath(join(dir, "qr.png"))).toBe(join(dir, "qr.png"));
    expect(safeQrOutputPath("qr.png")).toBe(join(process.cwd(), "qr.png"));
  });

  it("refuses to write outside cwd, the temp dir, and home", () => {
    expect(() => safeQrOutputPath("/etc/qr.png")).toThrow("Unsafe");
  });
});
