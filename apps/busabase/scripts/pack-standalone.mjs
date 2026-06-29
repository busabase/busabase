#!/usr/bin/env node
// Assemble the Next `output: "standalone"` build into a self-contained tree that
// `bin/busabase.mjs` can boot via `busabase server`. Run AFTER `next build`.
//
// Mirrors the runner stage of apps/busabase/Dockerfile, with one difference: the
// npm distribution defaults to embedded pglite, so `initPglite` runs Drizzle
// migrations from `process.cwd()/src/db/migrations` at first request. The bin
// chdirs into the standalone app dir, so the migrations (and static + public
// assets) must live there.
//
// The app dir is located by search rather than hardcoded: Next derives the
// standalone layout from its detected workspace root, so the relative path
// (`apps/busabase/`) can be nested deeper (e.g. inside a git worktree).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Find the dir holding the app `server.js` (path ends with `apps/busabase`). */
function findStandaloneApp(root) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        entry.name === "server.js" &&
        dir.replaceAll("\\", "/").endsWith("/apps/busabase")
      ) {
        return dir;
      }
    }
  }
  return undefined;
}

const standaloneApp = findStandaloneApp(resolve(appRoot, ".next/standalone"));
if (!standaloneApp) {
  console.error(
    "pack-standalone: no apps/busabase/server.js under .next/standalone.\n" +
      "Run `pnpm --filter busabase build` first.",
  );
  process.exit(1);
}

// [source, destination] — Next does not trace static assets or .sql migrations.
const copies = [
  [resolve(appRoot, ".next/static"), resolve(standaloneApp, ".next/static")],
  [resolve(appRoot, "public"), resolve(standaloneApp, "public")],
  [resolve(appRoot, "src/db/migrations"), resolve(standaloneApp, "src/db/migrations")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn(`pack-standalone: skip (missing) ${from}`);
    continue;
  }
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`pack-standalone: ${from} -> ${to}`);
}

// Strip any runtime state a local `busabase server` may have written into the tree
// (pglite data + file storage default to cwd-relative `.data/`). Never ship it.
await rm(resolve(standaloneApp, ".data"), { recursive: true, force: true });

// --- Rewrite Turbopack's hashed external module ids -----------------------
// Turbopack emits `serverExternalPackages` reached through `transpilePackages`
// (e.g. @electric-sql/pglite, @aws-sdk/client-s3, shiki) as a HASHED specifier
// like `@electric-sql/pglite-7966c14983af6418`. The real package is traced into
// `node_modules` under its TRUE name, but the chunks `require()` the hashed
// name, so a flat npm/npx install hits ERR_MODULE_NOT_FOUND at runtime on any
// storage/DB path (the pnpm-symlinked monorepo + Docker layouts happen to mask
// this). A node_modules symlink would fix it, but `npm publish` drops symlinks
// from the tarball — so instead rewrite the hashed specifier back to its real
// name directly in the built chunk source (survives packing; bundler-agnostic).
const standaloneRoot = resolve(appRoot, ".next/standalone");
const nodeModules = resolve(standaloneRoot, "node_modules");
// Matches a bare `<name>-<16hex>` token (scoped or not), with no string
// delimiters so it also catches subpath imports like `<name>-<hash>/worker`.
const HASH_TOKEN = /(?:@[\w.-]+\/)?[\w.-]+-[0-9a-f]{16}/g;
const serverDir = resolve(standaloneApp, ".next/server");

/** Walk every built `.js`/`.mjs` chunk under the server dir. */
function eachChunk(dir, fn) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") eachChunk(full, fn);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      fn(full);
    }
  }
}

// 1. Collect hashed tokens whose de-hashed package actually exists on disk.
const rewrites = new Map();
eachChunk(serverDir, (file) => {
  for (const token of readFileSync(file, "utf8").matchAll(HASH_TOKEN)) {
    const spec = token[0];
    if (rewrites.has(spec)) continue;
    const realName = spec.replace(/-[0-9a-f]{16}$/, "");
    if (realName !== spec && existsSync(resolve(nodeModules, realName))) {
      rewrites.set(spec, realName);
    }
  }
});

// 2. Replace every occurrence of those tokens with the real package name.
let rewritten = 0;
if (rewrites.size > 0) {
  eachChunk(serverDir, (file) => {
    const src = readFileSync(file, "utf8");
    let out = src;
    for (const [spec, realName] of rewrites) out = out.split(spec).join(realName);
    if (out !== src) {
      writeFileSync(file, out);
      rewritten++;
    }
  });
  for (const [spec, realName] of rewrites) {
    console.log(`pack-standalone: rewrite ${spec} -> ${realName}`);
  }
  console.log(
    `pack-standalone: rewrote ${rewrites.size} hashed external(s) across ${rewritten} chunk(s)`,
  );
}

console.log(`pack-standalone: assembled ${standaloneApp}`);
