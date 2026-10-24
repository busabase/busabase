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
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
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

// --- Repair the dependencies of every external ---------------------------------
// Next copies into `.next/standalone` only the files it traced. For a package that
// something imports lazily, or through an `exports` condition it could not follow,
// that is often nothing but `package.json` (and a package it judged unreachable is
// not copied at all, which is right: the browser-only variants in the AWS SDK are
// not needed here). Both are harmless until Node loads the package at runtime.
//
// What is not harmless is a dependency of the wrong VERSION, and that is what broke
// 0.98.0. The workspace holds three shiki: 4.5.0 at the root (fumadocs), and 3.23.0
// inside packages/kui and @streamdown/code, each with its own 3.23.0 `@shikijs/*`
// beside it. Next copied shiki 3.23.0 to `node_modules/shiki` but left its
// `@shikijs/*` dependencies as `package.json`-only stubs of the root's 4.5.0, and
// `promotePackage` above treats "a package.json already exists" as "already in
// place". At runtime shiki 3.23.0 then imported `@shikijs/core/dist/index.mjs` from
// a stub of the wrong major, and every page logged "Failed to load external module
// shiki".
//
// So, for each external, check its runtime dependencies the way Node resolves them
// from where the package now sits, and repair only what is demonstrably wrong:
//
//   - a dependency that resolves to a copy of an INCOMPATIBLE version (another major,
//     or another minor of 0.x), or to a manifest with no code in it, gets its own
//     copy, from the workspace, in this package's own `node_modules` where Node finds
//     it first. The root's other version stays: something else needs it. `pnpm
//     publish` keeps nested `node_modules`; what it cannot do is hold two versions at
//     one path. A traced copy of a compatible version (4.14.0 where 4.13.1 was
//     installed) is left: Node loads it fine, and nesting every such patch drift
//     would copy the AWS SDK's `@smithy/types` into ten places.
//   - a package copied here in full was never traced, so nothing about ITS
//     dependencies is known: all of them are checked the same way, and any that is
//     missing is copied too.
//   - an external is certainly loaded, so a dependency of it that is only a manifest
//     is filled in. A dependency that Next left out of a package it DID trace is left
//     out: that was Next's judgement, and acting on it would copy ~190 MB of AWS SDK
//     variants nothing loads.
const workspaceRoot = resolve(appRoot, "../..");
const HAS_CODE = /\.(?:[cm]?js|node|wasm)$/;

/** Semver-compatible for a caret range: same major, and for 0.x the same minor. */
function compatible(a, b) {
  const [majorA, minorA] = a.split(".").map(Number);
  const [majorB, minorB] = b.split(".").map(Number);
  return majorA === majorB && (majorA !== 0 || minorA === minorB);
}

function versionOf(dir) {
  try {
    return JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

/** True once a package directory holds anything Node could execute (not just its manifest). */
function hasCode(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    if (entry.name === "node_modules") return false;
    return entry.isDirectory() ? hasCode(resolve(dir, entry.name)) : HAS_CODE.test(entry.name);
  });
}

/** Resolve `name` the way Node does: the nearest `node_modules/<name>` walking up from `fromDir`. */
function resolveFrom(fromDir, name, stopAt) {
  for (let current = fromDir; ; current = dirname(current)) {
    if (basename(current) !== "node_modules") {
      const candidate = resolve(current, "node_modules", name);
      if (existsSync(resolve(candidate, "package.json"))) return candidate;
    }
    if (current === stopAt || dirname(current) === current) return undefined;
  }
}

/**
 * The workspace copy a traced package was installed as: the copy at the mirrored
 * path of any traced copy of it that has the same version. The standalone tree
 * mirrors the workspace layout, except that Next hoists one copy of an external to
 * the root, so the root copy's own path may point at a different version.
 */
function workspaceCopyOf(packageName, version) {
  for (const traced of findTracedPackages(standaloneRoot, packageName)) {
    const candidate = resolve(workspaceRoot, relative(standaloneRoot, traced));
    if (existsSync(candidate) && versionOf(candidate) === version) return realpathSync(candidate);
  }
  return undefined;
}

const repairVisited = new Set();
let repairCopies = 0;

/**
 * @param needed  the package must be loadable (something that loads it, or an
 *                external itself): a manifest-only copy is filled, not left.
 * @param direct  `targetDir` is an external, so every direct dependency is needed.
 */
async function repairPackage(targetDir, sourceDir, needed, direct = false) {
  if (repairVisited.has(targetDir)) return;
  repairVisited.add(targetDir);

  let copied = false;
  if (!hasCode(targetDir)) {
    if (!needed) return;
    // Never carry the source's own nested node_modules: each dependency is placed
    // below, against the version this package needs.
    await cp(sourceDir, targetDir, {
      recursive: true,
      dereference: true,
      filter: (path) => !relative(sourceDir, path).split(/[\\/]/).includes("node_modules"),
    });
    copied = true;
    repairCopies++;
    console.log(`pack-standalone: repair ${relative(standaloneRoot, targetDir)} from ${sourceDir}`);
  }

  const manifest = JSON.parse(readFileSync(resolve(sourceDir, "package.json"), "utf8"));
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const dependency of Object.keys(dependencies)) {
    if (dependency.startsWith("@types/")) continue; // types only: nothing Node loads
    const dependencySource = resolveFrom(sourceDir, dependency, dirname(workspaceRoot));
    if (!dependencySource) continue; // optional and not installed on this platform
    const source = realpathSync(dependencySource);
    const wanted = versionOf(source);
    const existing = resolveFrom(targetDir, dependency, standaloneRoot);
    const have = existing && versionOf(existing);
    if (have === wanted) {
      await repairPackage(existing, source, copied || direct);
    } else if (have && wanted && compatible(have, wanted) && hasCode(existing)) {
      // Traced, loadable, and what the dependency's range allows: Next's copy stands.
    } else if (existing || copied) {
      // An incompatible version or an empty manifest, or missing under a package
      // that was never traced: this package gets the copy it was installed with.
      await repairPackage(resolve(targetDir, "node_modules", dependency), source, true);
    }
  }
}

for (const realName of new Set(hashedPackages.values())) {
  const installed = resolve(nodeModules, realName);
  const version = versionOf(installed);
  const source = version ? workspaceCopyOf(realName, version) : undefined;
  if (!source) {
    console.warn(
      `pack-standalone: no workspace copy of ${realName}@${version}; dependencies not checked`,
    );
    continue;
  }
  await repairPackage(installed, source, true, true);
}
if (repairCopies > 0) {
  console.log(`pack-standalone: repaired ${repairCopies} dependency copy(ies) of the externals`);
}

console.log(`pack-standalone: assembled ${standaloneApp}`);
