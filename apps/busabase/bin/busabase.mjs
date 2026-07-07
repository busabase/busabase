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

// Colorize only on a real terminal that hasn't opted out (NO_COLOR).
const useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  brand: (s) => paint("38;5;43", s), // teal — Busabase accent
  bold: (s) => paint("1", s),
  dim: (s) => paint("2", s),
  cyan: (s) => paint("36", s),
  yellow: (s) => paint("33", s),
  green: (s) => paint("32", s),
};

function printSplash({ host, port, dataDir }) {
  const exposed = host === "0.0.0.0" || host === "::";
  // URL you'd actually open: 0.0.0.0/:: aren't browsable, point at localhost.
  const url = `http://${exposed ? "localhost" : host}:${port}`;
  const logo = [
    "  ____                  _                     ",
    " | __ ) _   _ ___  __ _| |__   __ _ ___  ___  ",
    " |  _ \\| | | / __|/ _` | '_ \\ / _` / __|/ _ \\ ",
    " | |_) | |_| \\__ \\ (_| | |_) | (_| \\__ \\  __/ ",
    " |____/ \\__,_|___/\\__,_|_.__/ \\__,_|___/\\___| ",
  ];

  const out = [];
  out.push("");
  for (const line of logo) out.push(c.brand(line));
  out.push(
    `${c.dim("   open-source review app")} ${c.dim("·")} ${c.dim("self-hosted, zero-setup")}`,
  );
  out.push("");
  out.push(`   ${c.green("➜")}  ${c.bold("Server")}   ${c.cyan(url)}`);
  out.push(`   ${c.green("➜")}  ${c.bold("Data")}     ${c.dim(dataDir)}`);
  out.push(
    `   ${c.green("➜")}  ${c.bold("Access")}   ${
      exposed
        ? c.yellow(`bound to ${host} — reachable from your network`)
        : c.dim(`bound to ${host} — this machine only`)
    }`,
  );
  out.push("");
  out.push(`   ${c.dim("Options")}`);
  out.push(
    `     ${c.cyan("--port")} ${c.dim("<n>")}      port to listen on        ${c.dim("(default 15419)")}`,
  );
  out.push(
    `     ${c.cyan("--host")} ${c.dim("<addr>")}   bind address             ${c.dim("(default 127.0.0.1)")}`,
  );
  out.push(
    `     ${c.cyan("--data")} ${c.dim("<dir>")}    data dir (db + uploads)  ${c.dim("(default ~/.busabase/data)")}`,
  );
  out.push("");
  out.push(`   ${c.dim("Tips")}`);
  out.push(`     ${c.dim("custom port")}      ${c.cyan("busabase server --port 8080")}`);
  out.push(`     ${c.dim("expose on LAN")}    ${c.cyan("busabase server --host 0.0.0.0")}`);

  if (exposed) {
    out.push("");
    out.push(`   ${c.yellow("⚠  Busabase is exposed on all network interfaces.")}`);
    out.push(
      `   ${c.dim("   It has no auth by default — only do this on a trusted network or behind a firewall.")}`,
    );
  } else {
    out.push(
      `     ${c.dim("⚠ exposing makes Busabase reachable by others — use only on a trusted network")}`,
    );
  }
  out.push("");

  console.error(out.join("\n"));
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

function printServerHelp() {
  const out = [];
  out.push("Usage:");
  out.push(`  busabase server [flags]`);
  out.push("");
  out.push("Flags:");
  out.push(
    `  ${c.cyan("--port")} ${c.dim("<n>")}      port to listen on        ${c.dim("(default 15419)")}`,
  );
  out.push(
    `  ${c.cyan("--host")} ${c.dim("<addr>")}   bind address             ${c.dim("(default 127.0.0.1)")}`,
  );
  out.push(
    `  ${c.cyan("--data")} ${c.dim("<dir>")}    data dir (db + uploads)  ${c.dim("(default ~/.busabase/data)")}`,
  );
  console.log(out.join("\n"));
}

async function startServer(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printServerHelp();
    return;
  }
  const port = flag(argv, "port") ?? process.env.PORT ?? "15419";
  const host = flag(argv, "host") ?? process.env.HOSTNAME ?? "127.0.0.1";
  // Canonical data root, shared verbatim with busabase-desktop and the Docker
  // image: <root>/pgdata holds the pglite database, <root>/storage holds
  // attachments. Same default location (~/.busabase/data) → same data whichever
  // way Busabase is launched. Override the root with --data / BUSABASE_DATA_DIR
  // (--db kept as a back-compat alias), or set PG_DATABASE_URL / STORAGE_URL
  // directly to point elsewhere.
  const dataDir = resolve(
    flag(argv, "data") ??
      flag(argv, "db") ??
      process.env.BUSABASE_DATA_DIR ??
      resolve(homedir(), ".busabase/data"),
  );
  const pgDir = resolve(dataDir, "pgdata");
  const storageDir = resolve(dataDir, "storage");

  await mkdir(pgDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });
  process.env.PORT = String(port);
  process.env.HOSTNAME = host;
  // pglite + local storage persist here so data survives restarts regardless of cwd.
  process.env.PG_DATABASE_URL ??= `pglite://${pgDir}`;
  process.env.STORAGE_URL ??= `local:${storageDir}?base_url=/api/dev/attachment`;
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
  printSplash({ host, port, dataDir });
  await import(entry);
}

async function runClientCli(argv) {
  let runCli;
  try {
    ({ runCli } = await import("busabase-cli"));
  } catch (error) {
    const siblingBin = resolve(pkgRoot, "../busabase-cli/bin/busabase-cli.mjs");
    if (existsSync(siblingBin)) {
      process.env.BUSABASE_CLI_DELEGATED_ARGV = JSON.stringify(argv);
      await import(siblingBin);
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "busabase: could not load busabase-cli.\n" +
        `Cause: ${message}\n\n` +
        "If you are running from source, build the CLI first:\n" +
        "  pnpm --filter busabase-cli build\n\n" +
        "For one-off npm usage, prefer:\n" +
        "  npm exec -y --package busabase@latest -- busabase <command>\n",
    );
    return 1;
  }
  return await runCli(argv);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "server") {
    await startServer(argv.slice(1));
    return;
  }
  const code = await runClientCli(argv);
  // The delegated client help doesn't know about the server role — append it.
  const wantsHelp = argv.length === 0 || ["-h", "--help", "help"].includes(argv[0]);
  if (wantsHelp && code === 0) {
    console.log(
      `\nServer:\n  busabase server [--port <n>] [--host <addr>] [--data <dir>]\n${c.dim("  boots the bundled Busabase server (zero setup, pglite) — see `busabase server --help`")}`,
    );
  }
  process.exit(code);
}

await main();
