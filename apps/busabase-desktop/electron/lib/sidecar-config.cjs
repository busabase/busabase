"use strict";

const path = require("node:path");

// Pure helpers that mirror src-tauri/src/sidecar.rs. Kept free of Electron and
// child_process so they can be unit tested with `node --test`.

/** `~/.busabase/data`, overridable with BUSABASE_DATA_DIR — same as the Tauri shell. */
const resolveDataDir = (env, homeDir) => {
  const override = env.BUSABASE_DATA_DIR?.trim();
  if (override) return override;
  return path.join(homeDir, ".busabase", "data");
};

const getLocalUrl = (port) => `http://localhost:${port}`;

const getDashboardUrl = (port) => `${getLocalUrl(port)}/dashboard`;

/** Environment for the packaged `node server.js` sidecar. */
const buildSidecarEnv = ({ baseEnv, dataDir, port }) => {
  const pgDir = path.join(dataDir, "pgdata");
  const storageDir = path.join(dataDir, "storage");
  const env = {
    ...baseEnv,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    PORT: String(port),
    PG_DATABASE_URL: `pglite://${pgDir}`,
    STORAGE_URL: `local:${storageDir}?base_url=/api/storage&upload_url=/api/storage/upload`,
  };
  // Never let Electron-specific switches leak into the plain Node sidecar.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return { env, pgDir, storageDir };
};

/**
 * Resolve the staged sidecar produced by scripts/prepare-tauri-build.mjs.
 * `entry.json` describes `server` (path to server.js) and `node` relative to
 * the sidecar root. Returns null when the entry is missing or incomplete.
 */
const resolveBundledSidecar = (sidecarRoot, { readFile, exists }) => {
  let entry;
  try {
    entry = JSON.parse(readFile(path.join(sidecarRoot, "entry.json")));
  } catch {
    return null;
  }
  if (typeof entry?.server !== "string" || typeof entry?.node !== "string") return null;

  const server = path.join(sidecarRoot, entry.server);
  const node = path.join(sidecarRoot, entry.node);
  if (!exists(server) || !exists(node)) return null;

  return {
    executable: node,
    args: [path.basename(server)],
    cwd: path.dirname(server),
  };
};

/** Last `limit` characters, safe on multi-byte boundaries. */
const tailChars = (value, limit) => {
  const chars = Array.from(value);
  return chars.slice(Math.max(0, chars.length - limit)).join("");
};

module.exports = {
  buildSidecarEnv,
  getDashboardUrl,
  getLocalUrl,
  resolveBundledSidecar,
  resolveDataDir,
  tailChars,
};
