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

// Next may trace dotenv files read during config evaluation into the standalone
// tree. They are local build inputs, never runtime assets for the published CLI.
async function removeEnvironmentFiles(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) {
      await removeEnvironmentFiles(full);
    } else if (entry.name !== ".env.example" && /^\.env(?:\..+)?$/.test(entry.name)) {
      await rm(full, { force: true });
      console.log(`pack-standalone: remove ${full}`);
    }
  }
}

await removeEnvironmentFiles(resolve(appRoot, ".next/standalone"));

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
// Turbopack emits these as string-literal module specifiers. Capture the package
// separately from an optional subpath so `pkg-<hash>/worker` becomes `pkg/worker`.
const HASH_SPECIFIER = /(["'`])((?:@[\w.-]+\/)?[\w.-]+-[0-9a-f]{16})((?:\/[^"'`]*)?)\1/g;
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

/** Find every traced copy of a package, including copies nested under workspaces. */
function findTracedPackages(root, packageName, found = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = resolve(root, entry.name);
    if (entry.name === "node_modules") {
      const candidate = resolve(full, packageName);
      if (existsSync(resolve(candidate, "package.json"))) found.push(candidate);
    }
    findTracedPackages(full, packageName, found);
  }
  return found;
}

/** Resolve a dependency as Node would from a traced package, then fall back to any traced copy. */
function findDependency(packageDir, packageName) {
  let current = packageDir;
  while (current.startsWith(standaloneRoot)) {
    const candidate = resolve(current, "node_modules", packageName);
    if (existsSync(resolve(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return findTracedPackages(standaloneRoot, packageName)[0];
}

/**
 * Promote a nested traced package into the standalone root. npm drops symlinks,
 * so copy real files and recursively promote runtime dependencies as well.
 */
async function promotePackage(packageName, sourceDir, promoting = new Set()) {
  const targetDir = resolve(nodeModules, packageName);
  if (existsSync(resolve(targetDir, "package.json"))) return;
  if (promoting.has(packageName)) return;
  promoting.add(packageName);

  await cp(sourceDir, targetDir, { recursive: true, dereference: true });
  const manifest = JSON.parse(readFileSync(resolve(sourceDir, "package.json"), "utf8"));
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  for (const dependency of Object.keys(dependencies)) {
    if (existsSync(resolve(nodeModules, dependency, "package.json"))) continue;
    const dependencyDir = findDependency(sourceDir, dependency);
    if (dependencyDir) await promotePackage(dependency, dependencyDir, promoting);
  }
  promoting.delete(packageName);
  console.log(`pack-standalone: promote ${packageName} from ${sourceDir}`);
}

// 1. Collect every hashed external. If Next traced the real package only into a
// nested workspace node_modules, promote it so the rewritten bare import resolves.
const hashedPackages = new Map();
eachChunk(serverDir, (file) => {
  for (const match of readFileSync(file, "utf8").matchAll(HASH_SPECIFIER)) {
    const hashedName = match[2];
    const realName = hashedName.replace(/-[0-9a-f]{16}$/, "");
    if (!hashedPackages.has(hashedName)) hashedPackages.set(hashedName, realName);
  }
});

for (const [hashedName, realName] of hashedPackages) {
  if (!existsSync(resolve(nodeModules, realName, "package.json"))) {
    const traced = findTracedPackages(standaloneRoot, realName)[0];
    if (!traced) {
      throw new Error(
        `pack-standalone: ${hashedName} references ${realName}, but Next did not trace that package`,
      );
    }
    await promotePackage(realName, traced);
  }
}

// 2. Replace every occurrence of those hashed package names with the real name.
let rewritten = 0;
if (hashedPackages.size > 0) {
  eachChunk(serverDir, (file) => {
    const src = readFileSync(file, "utf8");
    let out = src;
    for (const [hashedName, realName] of hashedPackages) {
      out = out.split(hashedName).join(realName);
    }
    if (out !== src) {
      writeFileSync(file, out);
      rewritten++;
    }
  });
  for (const [hashedName, realName] of hashedPackages) {
    console.log(`pack-standalone: rewrite ${hashedName} -> ${realName}`);
  }
  console.log(
    `pack-standalone: rewrote ${hashedPackages.size} hashed external(s) across ${rewritten} chunk(s)`,
  );
}

console.log(`pack-standalone: assembled ${standaloneApp}`);
