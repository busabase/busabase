import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toBase64 } from "../components/runners/local-runner";
import { writeFiles } from "./local-runtime";

describe("writeFiles", () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "airapp-writefiles-"));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("writes text files unchanged", async () => {
    await writeFiles(workdir, { "src/app.js": "export const x = 1;\n" });
    expect(await readFile(path.join(workdir, "src/app.js"), "utf-8")).toBe("export const x = 1;\n");
  });

  it("writes binary files byte-for-byte, not through the utf-8 path", async () => {
    // A real PNG header. Every byte here is ≥ 0x80 or a control code, which is
    // exactly what a utf-8 write destroys: those bytes are not valid utf-8
    // sequences, so they round-trip as U+FFFD (0xEF 0xBF 0xBD) and the file
    // lands with the right name and unusable contents. Asserting on the exact
    // bytes is the point — a length check alone would pass on the corrupted
    // version too, since replacement chars can coincidentally match in size.
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFiles(workdir, {}, { "public/logo.png": toBase64(pngHeader) });

    const written = await readFile(path.join(workdir, "public/logo.png"));
    expect(new Uint8Array(written)).toEqual(pngHeader);
  });

  it("creates nested directories for binary files", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    await writeFiles(workdir, {}, { "public/assets/deep/photo.jpg": toBase64(bytes) });
    const written = await readFile(path.join(workdir, "public/assets/deep/photo.jpg"));
    expect(new Uint8Array(written)).toEqual(bytes);
  });

  it("writes text and binary in the same call", async () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xfe, 0xff]);
    await writeFiles(
      workdir,
      { "index.html": "<!doctype html>" },
      { "public/icon.ico": toBase64(bytes) },
    );
    expect(await readFile(path.join(workdir, "index.html"), "utf-8")).toBe("<!doctype html>");
    expect(new Uint8Array(await readFile(path.join(workdir, "public/icon.ico")))).toEqual(bytes);
  });

  it("defaults binaryFiles so existing text-only callers keep working", async () => {
    await expect(writeFiles(workdir, { "a.txt": "hi" })).resolves.toBeUndefined();
    expect(await readFile(path.join(workdir, "a.txt"), "utf-8")).toBe("hi");
  });
});

describe("toBase64", () => {
  it("round-trips through Buffer, which is what the server decodes with", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f, 0x80]);
    expect(new Uint8Array(Buffer.from(toBase64(bytes), "base64"))).toEqual(bytes);
  });

  it("handles a payload larger than the argument-spread limit", () => {
    // The naive `String.fromCharCode(...bytes)` throws RangeError somewhere
    // above ~100k arguments. A 250 KB launch asset is past that; a small
    // fixture is not, so testing only a tiny image would let the broken
    // version pass. 1 MB of varied bytes reproduces the real payload size.
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;

    const encoded = toBase64(big);
    expect(new Uint8Array(Buffer.from(encoded, "base64"))).toEqual(big);
  });

  it("encodes empty input without throwing", () => {
    expect(toBase64(new Uint8Array([]))).toBe("");
  });
});
