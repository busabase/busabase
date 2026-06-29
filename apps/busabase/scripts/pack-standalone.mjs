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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, rm, symlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
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

// --- Alias Turbopack's hashed external module ids -------------------------
// Turbopack emits `serverExternalPackages` reached through `transpilePackages`
// (e.g. @electric-sql/pglite, @aws-sdk/client-s3) as a HASHED specifier like
// `@electric-sql/pglite-7966c14983af6418`. The real package is traced into
// `node_modules` under its true name, but the `require()` asks for the hashed
// name, so a flat npm install resolves it to ERR_MODULE_NOT_FOUND at runtime
// (the pnpm-symlinked monorepo/docker layouts happen to mask this). Fix it at
// the source: scan the built chunks for `<name>-<16hex>` specifiers whose
// de-hashed package exists, and symlink the hashed name to the real dir.
const standaloneRoot = resolve(appRoot, ".next/standalone");
const nodeModules = resolve(standaloneRoot, "node_modules");
const HASH_SPEC = /["'`]((?:@[\w.-]+\/)?[\w.-]+-[0-9a-f]{16})["'`]/g;

/** Collect every hashed external specifier referenced by the server chunks. */
function collectHashedSpecs(dir, found = new Set()) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") collectHashedSpecs(full, found);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(HASH_SPEC)) found.add(m[1]);
    }
  }
  return found;
}

const hashedSpecs = collectHashedSpecs(resolve(standaloneApp, ".next/server"));
let aliased = 0;
for (const spec of hashedSpecs) {
  const realName = spec.replace(/-[0-9a-f]{16}$/, "");
  if (realName === spec) continue;
  const realDir = resolve(nodeModules, realName);
  const aliasDir = resolve(nodeModules, spec);
  if (!existsSync(realDir) || existsSync(aliasDir)) continue;
  // Relative target so the link survives being copied/moved with the tree.
  await symlink(relative(dirname(aliasDir), realDir), aliasDir, "dir");
  console.log(`pack-standalone: alias ${spec} -> ${realName}`);
  aliased++;
}
if (aliased > 0) {
  console.log(`pack-standalone: linked ${aliased} hashed external package(s)`);
}

console.log(`pack-standalone: assembled ${standaloneApp}`);
