"use strict";

// Shared constants for the Electron-based UOS / Xinchuang build of Busabase Desktop.
//
// The Tauri shell (src-tauri/) stays the only shell for macOS, Windows and modern
// Linux. This Electron shell exists solely for GLIBC 2.28 systems (UOS 20, Kylin,
// NFS China) that ship neither GLIBC 2.39 nor WebKitGTK 4.1. Keep the port and
// data layout identical to src-tauri/src/sidecar.rs so both shells, the CLI and
// the Docker image share one local database.

const APP_ID = "com.busabase.app";
const PRODUCT_NAME = "Busabase Desktop";
const SIDECAR_PORT = 15419;
const SIDECAR_START_TIMEOUT_MS = 60_000;
// Next.js exits on SIGTERM only after its open sockets close. With the window
// already destroyed that takes about a second; the timeout is the backstop for
// a sidecar that is wedged.
const SIDECAR_STOP_TIMEOUT_MS = 8_000;
// A sidecar that was just told to quit keeps the port for a moment while it
// flushes PGLite, so a relaunch waits for the port instead of failing.
const PORT_RELEASE_WAIT_MS = 5_000;
const SIDECAR_LOG_FILE = "sidecar.log";
const UPDATE_PLATFORM_ID = "linux-x86_64-uos";
const UPDATE_MANIFEST_URL = "https://s1.busabase.com/public/downloads/busabase-desktop/latest.json";

module.exports = {
  APP_ID,
  PORT_RELEASE_WAIT_MS,
  PRODUCT_NAME,
  SIDECAR_LOG_FILE,
  SIDECAR_PORT,
  SIDECAR_START_TIMEOUT_MS,
  SIDECAR_STOP_TIMEOUT_MS,
  UPDATE_MANIFEST_URL,
  UPDATE_PLATFORM_ID,
};
