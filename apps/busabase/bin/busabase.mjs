#!/usr/bin/env node
// `busabase` — one command, two roles:
//   • `busabase server`  → boot the bundled Next standalone app (pglite, zero setup)
//   • anything else       → delegate to the busabase-cli client (talks to /api/v1)
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/bin
const pkgRoot = resolve(here, "..");

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

// The Next `output: "standalone"` build emits `server.js` under a path ending in
// `apps/busabase/` — but the prefix depends on Next's detected workspace root, so
// it can be nested (e.g. inside a git worktree). Fast-path the common layout,
// then fall back to a search so packaging-layout drift never breaks boot.
function findServerEntry() {
  const fast = resolve(pkgRoot, ".next/standalone/apps/busabase/server.js");
  if (existsSync(fast)) return fast;

  const root = resolve(pkgRoot, ".next/standalone");
  const stack = existsSync(root) ? [root] : [];
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
      if (entry.isDirectory()) {
        stack.push(resolve(dir, entry.name));
      } else if (
        entry.name === "server.js" &&
        dir.replaceAll("\\", "/").endsWith("/apps/busabase")
      ) {
        return resolve(dir, "server.js");
      }
    }
  }
  return undefined;
}

async function startServer(argv) {
  const port = flag(argv, "port") ?? process.env.PORT ?? "3061";
  const host = flag(argv, "host") ?? process.env.HOSTNAME ?? "127.0.0.1";
  const dataDir = resolve(
    flag(argv, "db") ?? process.env.BUSABASE_DATA_DIR ?? resolve(homedir(), ".busabase/data"),
  );

  await mkdir(dataDir, { recursive: true });
  process.env.PORT = String(port);
  process.env.HOSTNAME = host;
  // pglite persists here so data survives restarts regardless of cwd.
  process.env.PG_DATABASE_URL ??= `pglite://${dataDir}`;
  process.env.NODE_ENV ??= "production";

  const entry = findServerEntry();
  if (!entry) {
    console.error(
      "busabase: no built server found.\n" +
        "This package must ship the Next standalone build. If you are running from\n" +
        "source, build it first:  pnpm --filter busabase build\n",
    );
    process.exit(1);
  }
  // Standalone server.js resolves static/public relative to its own directory.
  process.chdir(dirname(entry));
  console.error(`busabase server → http://${host}:${port}  (data: ${dataDir})`);
  await import(entry);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "server") {
    await startServer(argv.slice(1));
    return;
  }
  const { runCli } = await import("busabase-cli");
  process.exit(await runCli(argv));
}

await main();
