import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Absolute path to the shared credential file every Busabase client reads/writes. */
export const dotEnvPath = (): string => join(homedir(), ".busabase", ".env");

/**
 * Read `~/.busabase/.env` (written by `busabase-cli login` or the setup skill) into a
 * record, so the CLI works without the user first `source`-ing it. Returns `{}` if the
 * file is absent or unreadable. Parses simple `KEY=value` lines, ignoring blanks and
 * `#` comments, and stripping surrounding quotes.
 */
export function loadDotEnvFile(): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(dotEnvPath(), "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Merge `updates` into `~/.busabase/.env` and rewrite it `0600` (owner-only), preserving
 * any keys the caller didn't touch. A `null` value deletes that key (used by `logout`).
 * Values are written verbatim as `KEY=value` — the same shape {@link loadDotEnvFile} parses.
 */
export function writeDotEnvFile(updates: Record<string, string | null>): void {
  const merged = { ...loadDotEnvFile() };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  const path = dotEnvPath();
  mkdirSync(join(homedir(), ".busabase"), { recursive: true });
  const body = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
  // Credentials — keep the file owner-only (best effort; no-op semantics on Windows).
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore (e.g. Windows / restricted FS)
  }
}
