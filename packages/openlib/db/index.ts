/**
 * Shared database utilities for all apps.
 *
 * - PGLite protocol detection (pglite://)
 * - URL sanitization for postgres.js
 * - Drizzle config helper (pglite + pg dual-mode)
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── PGLite protocol ──────────────────────────────────────────

const PGLITE_PROTOCOL = "pglite://";

export function isPgliteUrl(url: string): boolean {
  return url.startsWith(PGLITE_PROTOCOL);
}

/** Strip "pglite://" prefix → dataDir for PGLite */
export function parsePgliteDataDir(url: string): string {
  return url.slice(PGLITE_PROTOCOL.length);
}

function ensurePgliteDataDir(dataDir: string) {
  if (!dataDir || dataDir.startsWith("memory://")) {
    return;
  }

  const parentDir = dirname(dataDir);
  if (parentDir && parentDir !== "." && !existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
}

// ── URL sanitization ─────────────────────────────────────────

/**
 * Remove query params that postgres.js treats as session variables
 * but are not valid PostgreSQL parameters (e.g. ?schema=public).
 */
export function sanitizeDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    for (const param of ["schema", "connection_limit"]) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

// ── Drizzle config helper ────────────────────────────────────

/**
 * Parse PG_DATABASE_URL into drizzle-kit config fields.
 * Returns { dbCredentials, driver } ready to spread into defineConfig().
 *
 * Usage in drizzle.config.ts:
 * ```ts
 * import { parseDrizzleDbConfig } from "openlib/db";
 * const { dbCredentials, driver } = parseDrizzleDbConfig(process.env.PG_DATABASE_URL || "");
 * export default defineConfig({ ...driver, dbCredentials, ... });
 * ```
 */
export function parseDrizzleDbConfig(databaseUrl: string) {
  const usePglite = isPgliteUrl(databaseUrl);
  const pgliteDataDir = usePglite ? parsePgliteDataDir(databaseUrl) : "";
  if (pgliteDataDir) {
    ensurePgliteDataDir(pgliteDataDir);
  }

  return {
    dbCredentials: usePglite ? { url: pgliteDataDir } : { url: sanitizeDatabaseUrl(databaseUrl) },
    ...(usePglite ? { driver: "pglite" as const } : {}),
  };
}
