import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read-only "a new version exists" notice for `busabase` / `busabase-cli` — no
 * auto-update, no `update` subcommand, never touches anything but this cache
 * file. Both npm packages call this with their OWN name/version: `busabase`
 * (the self-hosted server) already depends on `busabase-cli` as a workspace
 * package, so it reuses this instead of a second copy.
 */

interface CacheEntry {
  lastCheckedAt: number;
  latestVersion: string;
}

type Cache = Record<string, CacheEntry>;

/** 24h — frequent enough to notice a new release, rare enough to never matter for latency. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Only paid on the (at most once per 24h, per package) cache-refresh path, and
 * only for a real network round trip — not on every command. A live check
 * against the real npm registry measured a cold DNS+TLS handshake at ~800ms
 * on its own, so anything near that cuts it too close and turns "occasionally
 * shows the notice a run late" into "usually misses it on the first try
 * after 24h" — 1500ms leaves real headroom while still being far short of
 * anything a human would perceive as the command hanging.
 */
const FETCH_TIMEOUT_MS = 1500;

function cacheDir(): string {
  return process.env.BUSABASE_UPDATE_CACHE_DIR || join(homedir(), ".cache", "busabase");
}

function cacheFile(): string {
  return join(cacheDir(), "update-check.json");
}

async function readCache(): Promise<Cache> {
  try {
    const raw = await readFile(cacheFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    // Missing file, unreadable, or corrupt JSON — treat as "no cache yet".
    return {};
  }
}

async function writeCacheEntry(packageName: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(cacheDir(), { recursive: true });
    const all = await readCache();
    all[packageName] = entry;
    await writeFile(cacheFile(), JSON.stringify(all), "utf8");
  } catch {
    // Best-effort only. A cache write failure (read-only home dir, disk full,
    // permissions…) must never surface as a command failure — worst case, the
    // next run just checks again.
  }
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    // Offline, DNS failure, timeout, registry down, malformed response — all
    // the same outcome: no notice this run, try again next time.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Opted out via env, CI, or a non-interactive terminal — a notice nobody will read. */
function checksDisabled(): boolean {
  if (process.env.BUSABASE_NO_UPDATE_CHECK) return true;
  if (process.env.CI === "true") return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

function formatNotice(packageName: string, currentVersion: string, latestVersion: string): string {
  return (
    `\nA new version of ${packageName} is available: ${currentVersion} → ${latestVersion}\n` +
    `Run \`npm i -g ${packageName}@latest\` to update.\n`
  );
}

/**
 * Returns an update notice string if a newer version is known, else `null` —
 * caller decides where that goes (stderr for `busabase-cli`, the server boot
 * banner for `busabase`). Never throws.
 *
 * Cache hit (checked within the last 24h): synchronous-fast, no network call.
 * Cache miss/stale: pays for ONE bounded (`FETCH_TIMEOUT_MS`) registry round
 * trip so this run can already show the notice if a new version just shipped;
 * a genuinely slow/dead network just means this run stays silent and the next
 * stale check tries again — the timeout caps the worst case, it doesn't
 * silently retry in the background past process exit (a short-lived CLI
 * process can't rely on a detached background task actually finishing).
 */
export async function checkForUpdate(
  packageName: string,
  currentVersion: string,
): Promise<string | null> {
  if (checksDisabled()) return null;

  const cache = await readCache();
  const cached = cache[packageName];
  const isStale = !cached || Date.now() - cached.lastCheckedAt > CHECK_INTERVAL_MS;

  if (!isStale) {
    return cached.latestVersion !== currentVersion
      ? formatNotice(packageName, currentVersion, cached.latestVersion)
      : null;
  }

  const latest = await fetchLatestVersion(packageName);
  if (!latest) return null;
  await writeCacheEntry(packageName, { lastCheckedAt: Date.now(), latestVersion: latest });
  return latest !== currentVersion ? formatNotice(packageName, currentVersion, latest) : null;
}
