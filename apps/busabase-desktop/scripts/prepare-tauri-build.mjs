#!/usr/bin/env node

// Packages apps/busabase's Next.js `output: "standalone"` build into a
// self-contained sidecar resource for Busabase Desktop.
//
// The resulting tree (src-tauri/resources/busabase-server/) contains:
//   - the entire `.next/standalone` output (server.js + traced node_modules)
//   - `.next/static` and `public` copied next to the app's server.js
//   - a bundled `node` runtime
//   - entry.json describing where server.js and node live (relative paths)
//
// At runtime the Rust layer reads entry.json, then launches
// `node <server.js>` on port 3061 as the Busabase sidecar. The desktop SPA
// renders that sidecar's /dashboard.

import { execFile } from "node:child_process";
import { createWriteStream, constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(scriptDir, "..");
const repoDir = join(desktopDir, "..", "..");
const busabaseDir = join(repoDir, "apps", "busabase");
const standaloneDir = join(busabaseDir, ".next", "standalone");
const staticDir = join(busabaseDir, ".next", "static");
const publicDir = join(busabaseDir, "public");
const migrationsDir = join(busabaseDir, "src", "db", "migrations");
const resourceDir = join(desktopDir, "src-tauri", "resources", "busabase-server");
const macOSEntitlementsPath = join(desktopDir, "src-tauri", "Entitlements.plist");

const platformNodeName = process.platform === "win32" ? "node.exe" : "node";
const macOSNativeBinaryExtensions = new Set([".dylib", ".node"]);

const ensureExists = async (path, label) => {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} is missing: ${relative(repoDir, path)}`);
  }
};

const runPnpm = async (args) => {
  if (process.env.npm_execpath?.trim()) {
    const pnpmPath = process.env.npm_execpath.trim();
    const executable =
      pnpmPath.endsWith(".js") || pnpmPath.endsWith(".cjs") ? process.execPath : pnpmPath;
    const executableArgs = executable === process.execPath ? [pnpmPath, ...args] : args;
    await execFileAsync(executable, executableArgs, {
      cwd: repoDir,
      maxBuffer: 1024 * 1024 * 64,
    });
    return;
  }
  await execFileAsync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: repoDir,
    maxBuffer: 1024 * 1024 * 64,
  });
};

// Bundle a self-contained Node runtime to launch the standalone server.
//
// `process.execPath` is NOT portable on every host (e.g. Homebrew node is a
// thin launcher that dynamically loads libnode via @rpath). We therefore fetch
// the official, self-contained Node binary for the build host's platform/arch
// (pinned to the host Node version) and bundle just its `node` executable.
// `BUSABASE_DESKTOP_NODE` can override with a path to a known-good binary, and
// we fall back to copying `process.execPath` if the download is unavailable.
const distArch = () => {
  const targetTriple = process.env.BUSABASE_DESKTOP_TARGET_TRIPLE?.trim();
  if (targetTriple?.startsWith("x86_64-")) return "x64";
  if (targetTriple?.startsWith("aarch64-")) return "arm64";
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "arm") return "armv7l";
  return process.arch;
};

const bundleNode = async (targetPath) => {
  const override = process.env.BUSABASE_DESKTOP_NODE?.trim();
  if (override) {
    await cp(override, targetPath, { dereference: true });
    await chmod(targetPath, 0o755).catch(() => {});
    return `override (${override})`;
  }

  const version = `v${process.versions.node}`;
  const arch = distArch();
  const isWin = process.platform === "win32";
  const platformTag = isWin ? "win" : process.platform; // darwin | linux | win
  const ext = isWin ? "zip" : process.platform === "linux" ? "tar.xz" : "tar.gz";
  const base = `node-${version}-${platformTag}-${arch}`;
  const url = `https://nodejs.org/dist/${version}/${base}.${ext}`;

  const cacheDir = join(tmpdir(), "busabase-desktop-node-cache", `${base}`);
  const archivePath = join(cacheDir, `${base}.${ext}`);
  const extractedNode = isWin
    ? join(cacheDir, base, "node.exe")
    : join(cacheDir, base, "bin", "node");

  try {
    await access(extractedNode, fsConstants.X_OK);
  } catch {
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Node runtime: ${url} (${response.status})`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
    if (isWin) {
      await execFileAsync("unzip", ["-q", archivePath, "-d", cacheDir], {
        maxBuffer: 1024 * 1024 * 64,
      });
    } else {
      const flag = process.platform === "linux" ? "-xJf" : "-xzf";
      await execFileAsync("tar", [flag, archivePath, "-C", cacheDir], {
        maxBuffer: 1024 * 1024 * 64,
      });
    }
    await access(extractedNode, fsConstants.R_OK);
  }

  await cp(extractedNode, targetPath, { dereference: true });
  await chmod(targetPath, 0o755).catch(() => {});
  return `nodejs.org ${version} ${platformTag}-${arch}`;
};

const hasMacOSNativeExtension = (path) =>
  [...macOSNativeBinaryExtensions].some((extension) => path.endsWith(extension));

const isMachO = async (path) => {
  try {
    const { stdout } = await execFileAsync("file", ["-b", path], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.includes("Mach-O");
  } catch {
    return false;
  }
};

const collectMacOSCodeSignCandidates = async (root) => {
  const candidates = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const stats = await stat(full);
      const executable = (stats.mode & 0o111) !== 0;
      if (hasMacOSNativeExtension(full) || (executable && (await isMachO(full)))) {
        candidates.push(full);
      }
    }
  }

  return candidates.sort((a, b) => b.split("/").length - a.split("/").length);
};

const signMacOSSidecarBinaries = async () => {
  if (process.platform !== "darwin") return 0;

  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (!identity) {
    console.warn("Skipping Busabase sidecar code signing: APPLE_SIGNING_IDENTITY is not set.");
    return 0;
  }

  const candidates = await collectMacOSCodeSignCandidates(resourceDir);
  for (const candidate of candidates) {
    const args = [
      "--force",
      "--timestamp",
      "--options",
      "runtime",
      "--entitlements",
      macOSEntitlementsPath,
      "--sign",
      identity,
      candidate,
    ];
    await execFileAsync("codesign", args, {
      maxBuffer: 1024 * 1024 * 4,
    });
  }

  return candidates.length;
};

// Find `apps/busabase/server.js` within the standalone output. With
// outputFileTracingRoot pinned to the workspace root this is a stable
// `apps/busabase/server.js`, but we resolve it defensively so the script keeps
// working even if the tracing layout shifts.
const findServerEntry = async () => {
  const stable = join(standaloneDir, "apps", "busabase", "server.js");
  try {
    await access(stable, fsConstants.R_OK);
    return stable;
  } catch {
    // fall through to a bounded search
  }

  const queue = [{ dir: standaloneDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 8) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
      const full = join(dir, entry.name);
      if (
        entry.isFile() &&
        entry.name === "server.js" &&
        full.includes(`${join("apps", "busabase")}`)
      ) {
        return full;
      }
      if (entry.isDirectory()) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  throw new Error("Could not find apps/busabase/server.js in the standalone build output.");
};

const main = async () => {
  await ensureExists(join(busabaseDir, "package.json"), "Busabase app package");
  await ensureExists(process.execPath, "Node runtime");
  await ensureExists(migrationsDir, "Busabase PGlite migrations");

  // Build the standalone server so `tauri build` is self-contained.
  await runPnpm(["--filter", "busabase", "build"]);
  await ensureExists(standaloneDir, "Busabase standalone build output");

  const serverEntry = await findServerEntry();
  const appDir = dirname(serverEntry); // <standalone>/apps/busabase
  const serverRel = relative(standaloneDir, serverEntry).split("\\").join("/");
  const appRel = dirname(serverRel);

  // Reset and copy the whole standalone tree verbatim (server + node_modules).
  await rm(resourceDir, { recursive: true, force: true });
  await mkdir(resourceDir, { recursive: true });
  await cp(standaloneDir, resourceDir, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => {
      const normalized = sourcePath.split("\\").join("/");
      return !normalized.includes("/node_modules/.cache/");
    },
  });

  // Next does not copy static assets / public into standalone; place them next
  // to the app's server.js (the locations the standalone server serves from).
  await ensureExists(staticDir, "Busabase .next/static output");
  await cp(staticDir, join(resourceDir, appRel, ".next", "static"), {
    recursive: true,
    dereference: true,
  });
  try {
    await access(publicDir, fsConstants.R_OK);
    await cp(publicDir, join(resourceDir, appRel, "public"), {
      recursive: true,
      dereference: true,
    });
  } catch {
    // public/ is optional
  }

  // busabase-core resolves PGlite migrations from process.cwd()/src/db/migrations.
  // The packaged sidecar runs with cwd=<resource>/apps/busabase, so migrations
  // must be copied beside server.js; otherwise first launch cannot initialize
  // the local PGlite database.
  await cp(migrationsDir, join(resourceDir, appRel, "src", "db", "migrations"), {
    recursive: true,
    dereference: true,
  });

  // Bundle the Node runtime used to launch server.js.
  const nodeTarget = join(resourceDir, platformNodeName);
  let nodeSource;
  try {
    nodeSource = await bundleNode(nodeTarget);
  } catch (error) {
    console.warn(
      `⚠ Could not bundle a self-contained Node runtime (${error.message}). ` +
        "Falling back to process.execPath; the packaged app may require Node on PATH.",
    );
    await cp(process.execPath, nodeTarget, { dereference: true });
    await chmod(nodeTarget, 0o755).catch(() => {});
    nodeSource = `process.execPath (${process.execPath})`;
  }

  await writeFile(
    join(resourceDir, "entry.json"),
    `${JSON.stringify({ server: serverRel, node: platformNodeName }, null, 2)}\n`,
    "utf8",
  );

  const signedBinaryCount = await signMacOSSidecarBinaries();
  const nodeStats = await stat(nodeTarget);
  console.log(
    `Prepared Busabase sidecar resource at ${relative(repoDir, resourceDir)}\n` +
      `  server: ${serverRel}\n` +
      `  node:   ${platformNodeName} (${Math.round(nodeStats.size / 1024 / 1024)} MB) via ${nodeSource}\n` +
      `  pglite: ${relative(repoDir, migrationsDir)} -> ${appRel}/src/db/migrations\n` +
      `  signed: ${signedBinaryCount} macOS native binaries\n` +
      `  appDir: ${relative(repoDir, appDir)}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
