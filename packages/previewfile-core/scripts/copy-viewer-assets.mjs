#!/usr/bin/env node
// Copies the files previewfile-core's SQLite and archive viewers load at
// runtime from the host's own origin into the host's public/ directory:
//
//   /sql-wasm/sql-wasm-browser.wasm  ← sql.js (SqliteViewer's `locateFile`)
//   /libarchive/worker-bundle.js     ← libarchive.js (ArchiveViewer's `workerUrl`)
//   /libarchive/wasm-gen/*           ← loaded by that worker, relative to itself
//
// Hosts run it before `dev` and `build` and gitignore the output, so the files
// always come from the package versions previewfile-core is installed with
// instead of a hand-copied snapshot per app:
//
//   node ../../packages/previewfile-core/scripts/copy-viewer-assets.mjs public

import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Neither package exports its package.json, so locate each dist/ through its entry.
const sqlJsDist = () => path.dirname(require.resolve("sql.js"));
const libarchiveDist = () => path.join(path.dirname(require.resolve("libarchive.js")), "dist");

/** `[source, destination relative to public/]` for every file the viewers fetch. */
export const viewerAssets = () => [
  [path.join(sqlJsDist(), "sql-wasm-browser.wasm"), "sql-wasm/sql-wasm-browser.wasm"],
  [path.join(libarchiveDist(), "worker-bundle.js"), "libarchive/worker-bundle.js"],
  [path.join(libarchiveDist(), "wasm-gen"), "libarchive/wasm-gen"],
];

export const copyViewerAssets = (publicDir) => {
  const copied = [];
  for (const [source, relative] of viewerAssets()) {
    const destination = path.join(publicDir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    copied.push(relative);
  }
  return copied;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicDir = path.resolve(process.argv[2] ?? "public");
  const copied = copyViewerAssets(publicDir);
  console.log(`[previewfile-core] viewer assets → ${publicDir}: ${copied.join(", ")}`);
}
