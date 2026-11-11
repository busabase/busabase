import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyViewerAssets } from "./copy-viewer-assets.mjs";

describe("copyViewerAssets", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("puts every file the SQLite and archive viewers fetch where they fetch it", () => {
    const publicDir = mkdtempSync(path.join(os.tmpdir(), "viewer-assets-"));
    dirs.push(publicDir);

    copyViewerAssets(publicDir);

    // SqliteViewer: initSqlJs({ locateFile: (f) => `/sql-wasm/${f}` }) with sql.js' browser build.
    const wasm = readFileSync(path.join(publicDir, "sql-wasm/sql-wasm-browser.wasm"));
    expect(wasm.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    // ArchiveViewer: Archive.init({ workerUrl: "/libarchive/worker-bundle.js" }), and the
    // worker resolves its wasm as `wasm-gen/<file>` next to itself.
    const worker = readFileSync(path.join(publicDir, "libarchive/worker-bundle.js"), "utf8");
    expect(worker).toContain("wasm-gen/");
    expect(
      statSync(path.join(publicDir, "libarchive/wasm-gen/libarchive.wasm")).size,
    ).toBeGreaterThan(0);
  });

  it("can run again over existing output", () => {
    const publicDir = mkdtempSync(path.join(os.tmpdir(), "viewer-assets-"));
    dirs.push(publicDir);

    copyViewerAssets(publicDir);
    expect(() => copyViewerAssets(publicDir)).not.toThrow();
  });
});
