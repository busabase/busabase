"use strict";

// Owns the lifetime of the local Busabase sidecar (`node server.js`) for the
// Electron UOS shell. Behaviour mirrors src-tauri/src/sidecar.rs: same port,
// same data dir, same health probe, reuse an already-running Busabase, and
// refuse to start when the port is held by something else.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const {
  PORT_RELEASE_WAIT_MS,
  SIDECAR_LOG_FILE,
  SIDECAR_PORT,
  SIDECAR_START_TIMEOUT_MS,
  SIDECAR_STOP_TIMEOUT_MS,
} = require("./constants.cjs");
const { buildSidecarEnv, resolveBundledSidecar, tailChars } = require("./sidecar-config.cjs");

const LOG_SUMMARY_CHARS = 2000;
const POLL_INTERVAL_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isBusabaseHealthy = (port = SIDECAR_PORT) =>
  new Promise((resolve) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: 800,
        // No keep-alive: a pooled socket would linger in the shell and make
        // Next.js wait for it during its SIGTERM shutdown.
        agent: false,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
    request.on("close", () => resolve(false));
  });

const isPortOpen = (port = SIDECAR_PORT) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

/**
 * Wait for a port to be released. A Busabase sidecar that just received SIGTERM
 * keeps listening while Next.js drains its connections, so a relaunch right
 * after a quit must wait rather than report the port as taken.
 * @returns {Promise<boolean>} true once nothing is listening anymore.
 */
const waitForPortRelease = async ({ port, timeoutMs, probe = isPortOpen }) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await probe(port))) return true;
    if (Date.now() >= deadline) return false;
    await delay(POLL_INTERVAL_MS);
  }
};

const readLogSummary = (logPath) => {
  try {
    const contents = fs.readFileSync(logPath, "utf8").trim();
    return contents ? tailChars(contents, LOG_SUMMARY_CHARS) : null;
  } catch {
    return null;
  }
};

class SidecarManager {
  /**
   * @param {{ sidecarRoot: string, dataDir: string, port?: number }} options
   */
  constructor({ sidecarRoot, dataDir, port = SIDECAR_PORT }) {
    this.sidecarRoot = sidecarRoot;
    this.dataDir = dataDir;
    this.port = port;
    this.child = null;
    this.logPath = path.join(dataDir, SIDECAR_LOG_FILE);
  }

  startError(reason) {
    const summary = readLogSummary(this.logPath);
    return summary
      ? `Busabase sidecar ${reason}. Last log output: ${summary} (full log: ${this.logPath})`
      : `Busabase sidecar ${reason}. No output was captured; see ${this.logPath}.`;
  }

  /** @returns {Promise<{ mode: "managed" | "external" }>} */
  async start() {
    if (this.child && this.child.exitCode === null && (await isBusabaseHealthy(this.port))) {
      return { mode: "managed" };
    }
    if (await isBusabaseHealthy(this.port)) return { mode: "external" };
    if (await isPortOpen(this.port)) {
      // Give a sidecar that is still shutting down time to release the port,
      // then re-check whether a healthy Busabase appeared in the meantime.
      const released = await waitForPortRelease({
        port: this.port,
        timeoutMs: PORT_RELEASE_WAIT_MS,
      });
      if (!released) {
        throw new Error(
          `Port ${this.port} is already in use, but it is not serving Busabase. Close the process using that port, then retry.`,
        );
      }
      if (await isBusabaseHealthy(this.port)) return { mode: "external" };
    }

    const sidecar = resolveBundledSidecar(this.sidecarRoot, {
      readFile: (file) => fs.readFileSync(file, "utf8"),
      exists: (file) => fs.existsSync(file),
    });
    if (!sidecar) {
      throw new Error(`The bundled Busabase server is missing from ${this.sidecarRoot}.`);
    }

    const { env, pgDir, storageDir } = buildSidecarEnv({
      baseEnv: process.env,
      dataDir: this.dataDir,
      port: this.port,
    });
    for (const dir of [this.dataDir, pgDir, storageDir]) fs.mkdirSync(dir, { recursive: true });

    const logFd = fs.openSync(this.logPath, "w");
    let child;
    try {
      child = spawn(sidecar.executable, sidecar.args, {
        cwd: sidecar.cwd,
        env,
        stdio: ["ignore", logFd, logFd],
      });
    } finally {
      fs.closeSync(logFd);
    }
    this.child = child;

    const spawnError = new Promise((_, reject) => {
      child.once("error", (error) =>
        reject(new Error(`Failed to start Busabase sidecar: ${error.message}`)),
      );
    });

    try {
      await Promise.race([this.waitUntilHealthy(child), spawnError]);
    } catch (error) {
      await this.stop();
      throw error;
    }
    return { mode: "managed" };
  }

  async waitUntilHealthy(child) {
    const deadline = Date.now() + SIDECAR_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await isBusabaseHealthy(this.port)) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        const status = child.signalCode ?? `exit status: ${child.exitCode}`;
        throw new Error(this.startError(`exited with ${status}`));
      }
      await delay(POLL_INTERVAL_MS);
    }
    throw new Error(
      this.startError(
        `did not become healthy within ${Math.round(SIDECAR_START_TIMEOUT_MS / 1000)} seconds`,
      ),
    );
  }

  /** Stop only a sidecar this shell started; never kill an external Busabase. */
  async stop() {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timedOut = await Promise.race([
      exited.then(() => false),
      delay(SIDECAR_STOP_TIMEOUT_MS).then(() => true),
    ]);
    if (timedOut) {
      child.kill("SIGKILL");
      await exited;
    }
  }

  /** Synchronous best effort for process "exit" handlers. */
  killNow() {
    if (this.child && this.child.exitCode === null) this.child.kill("SIGKILL");
    this.child = null;
  }
}

module.exports = { SidecarManager, isBusabaseHealthy, isPortOpen, waitForPortRelease };
