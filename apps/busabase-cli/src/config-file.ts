import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Credential + settings storage for every Busabase client.
 *
 * Two files, split the way `gh` (config.yml / hosts.yml) and `aws` (config /
 * credentials) split theirs — settings are shareable, credentials are not:
 *
 *   ~/.busabase/
 *   ├── .env                 credentials of the ACTIVE profile (0600). Always present.
 *   ├── config.json          (optional) settings + which profile is active.
 *   └── profiles/            (optional) one .env per account; grows lazily.
 *       ├── default.env
 *       └── work.env
 *
 * Single-account users never see any of this: with no `config.json` the CLI reads
 * and writes `~/.busabase/.env` exactly as it always has, and neither `config.json`
 * nor `profiles/` is ever created.
 *
 * `~/.busabase/.env` is NOT private to this CLI — the `busabase` skill, the docs'
 * curl snippets and SDK users all read (or `source`) it. So it stays the complete,
 * verbatim copy of whichever profile is active: switching profiles rewrites it, and
 * every one of those consumers follows along without knowing profiles exist. The
 * `BUSABASE_PROFILE` line written into it is a read-only mirror field for their
 * benefit (same role as gh's redundant top-level `oauth_token`) — the authority on
 * which profile is active is `config.json`, never the mirror and never the mere
 * existence of a directory.
 */

export const busabaseDir = (): string => join(homedir(), ".busabase");

/** Absolute path to the shared credential file every Busabase client reads/writes. */
export const dotEnvPath = (): string => join(busabaseDir(), ".env");

export const configJsonPath = (): string => join(busabaseDir(), "config.json");

export const profilesDir = (): string => join(busabaseDir(), "profiles");

export const profilePath = (name: string): string => join(profilesDir(), `${name}.env`);

/** Profile used when the user never named one — the single-account case. */
export const DEFAULT_PROFILE = "default";

/**
 * Mirror-only key written into `.env` so anyone who `source`s it can tell which
 * account they got. Never stored in a `profiles/*.env`, never used to decide
 * anything: `config.json.currentProfile` is the only authority.
 */
export const PROFILE_KEY = "BUSABASE_PROFILE";

const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Profile names become filenames — keep them boring and path-traversal-free. */
export function assertValidProfileName(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use letters, digits, dot, dash or underscore (must start with a letter or digit).`,
    );
  }
}

// ── Low-level KEY=value file IO ──────────────────────────────────────────────

/** Parse simple `KEY=value` lines, ignoring blanks and `#` comments, stripping quotes. */
function parseEnvText(text: string): Record<string, string> {
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

/** Read a `KEY=value` file; `{}` when absent or unreadable. */
export function readEnvFileAt(path: string): Record<string, string> {
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Write a `KEY=value` file `0600` (owner-only), creating parent directories. */
function writeEnvFileAt(path: string, data: Record<string, string>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const body = Object.entries(data)
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

// ── config.json (settings, non-secret) ───────────────────────────────────────

export interface CliConfigFile {
  /** Which profile `.env` currently mirrors. Absent ⇒ single-account mode. */
  currentProfile?: string;
  /** Default `--output` format, so `--output json` need not be typed every time. */
  output?: string;
}

/** Read `~/.busabase/config.json`; `{}` when absent or malformed. */
export function loadConfigFile(): CliConfigFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configJsonPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as CliConfigFile;
  } catch {
    return {};
  }
}

/** Merge into `config.json` (0644 — no secrets live here). `null` deletes a key. */
export function writeConfigFile(updates: Record<string, string | null>): void {
  const merged: Record<string, unknown> = { ...loadConfigFile() };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  mkdirSync(busabaseDir(), { recursive: true });
  writeFileSync(configJsonPath(), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

/** True once the user owns more than one account, i.e. `config.json` names a profile. */
export function isMultiProfile(): boolean {
  return Boolean(loadConfigFile().currentProfile);
}

/** The active profile name — `default` while still in single-account mode. */
export function currentProfileName(): string {
  return loadConfigFile().currentProfile ?? DEFAULT_PROFILE;
}

// ── Credential target resolution ─────────────────────────────────────────────

export interface CredentialTarget {
  /** Authoritative file this invocation reads, and writes first. */
  path: string;
  /** Kept in sync on write: the `.env` mirror, or the profile behind the mirror. */
  secondaryPath?: string;
  /** Profile this target belongs to; absent for an explicit `--config` file. */
  profile?: string;
}

export interface TargetSelector {
  /** `--profile <name>` */
  profile?: string;
  /** `--config <path>` — an explicit file, bypassing profiles entirely. */
  config?: string;
}

/**
 * Resolve which file this invocation reads and writes.
 *
 * - `--config <path>`: that file alone. No mirror, no `config.json`.
 * - `--profile <name>` / `BUSABASE_PROFILE`: `profiles/<name>.env` directly, so two
 *   terminals driving two accounts never trip over each other's `.env`. Writes still
 *   refresh the mirror when that profile is the active one.
 * - Neither: the `.env` mirror, with writes echoed back into the active profile so a
 *   rotated token isn't lost the next time the user switches away and back.
 */
export function resolveCredentialTarget(selector: TargetSelector = {}): CredentialTarget {
  const explicit = selector.config ?? process.env.BUSABASE_CONFIG;
  if (explicit) return { path: explicit };

  const requested = selector.profile ?? process.env.BUSABASE_PROFILE;
  const current = currentProfileName();

  if (requested) {
    assertValidProfileName(requested);
    const path = profilePath(requested);
    // Asking for the active profile before `profiles/` exists is just the plain
    // single-account case — serve it from `.env` rather than an empty file.
    if (!existsSync(path) && requested === current && !isMultiProfile()) {
      return { path: dotEnvPath(), profile: requested };
    }
    return {
      path,
      secondaryPath: requested === current ? dotEnvPath() : undefined,
      profile: requested,
    };
  }

  return {
    path: dotEnvPath(),
    secondaryPath: isMultiProfile() ? profilePath(current) : undefined,
    profile: current,
  };
}

let activeTarget: CredentialTarget | undefined;

/** Pin the target for this process once global flags are parsed. */
export function setActiveCredentialTarget(target: CredentialTarget): void {
  activeTarget = target;
}

/** Target in force; falls back to environment-only resolution (tests, programmatic use). */
export function activeCredentialTarget(): CredentialTarget {
  return activeTarget ?? resolveCredentialTarget();
}

/** Test seam — drop the pinned target so the next call re-resolves. */
export function resetActiveCredentialTarget(): void {
  activeTarget = undefined;
}

/**
 * File this invocation actually persists credentials to — what `login` / `logout`
 * should name on screen. Equals {@link dotEnvPath} in the single-account case, but
 * `--profile work` really does write `profiles/work.env`, and saying `.env` there
 * would send anyone looking for the file to the wrong place.
 */
export function activeCredentialPath(): string {
  return activeCredentialTarget().path;
}

// ── Public read/write (signature-compatible with the single-account original) ─

/**
 * Read the active credential file (written by `busabase-cli login` or the setup
 * skill) into a record, so the CLI works without the user first `source`-ing it.
 * Returns `{}` if the file is absent or unreadable.
 */
export function loadDotEnvFile(): Record<string, string> {
  return readEnvFileAt(activeCredentialTarget().path);
}

/**
 * Merge `updates` into the active credential file, preserving untouched keys; a
 * `null` value deletes that key (used by `logout`). The paired file — the `.env`
 * mirror, or the profile behind it — is rewritten with the same content, so the
 * skill/curl/SDK path always sees the active account.
 */
export function writeDotEnvFile(updates: Record<string, string | null>): void {
  const target = activeCredentialTarget();
  const merged = { ...readEnvFileAt(target.path) };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  // The mirror field is derived, never stored or carried between files.
  delete merged[PROFILE_KEY];

  writeCredentialPair(target, merged);
}

/** Write `data` to a target's primary file plus its paired file, mirror field included. */
function writeCredentialPair(target: CredentialTarget, data: Record<string, string>): void {
  const mirrored = { ...data, ...(target.profile ? { [PROFILE_KEY]: target.profile } : {}) };
  const isPrimaryMirror = target.path === dotEnvPath();

  writeEnvFileAt(target.path, isPrimaryMirror && isMultiProfile() ? mirrored : data);
  if (!target.secondaryPath) return;
  writeEnvFileAt(target.secondaryPath, target.secondaryPath === dotEnvPath() ? mirrored : data);
}

// ── Profile management ───────────────────────────────────────────────────────

/**
 * Enter multi-account mode: preserve today's `.env` as `profiles/default.env` and
 * record it as active. Called the moment a second account first comes into play —
 * never on upgrade, so an untouched single-account install stays byte-identical.
 */
export function ensureProfilesInitialized(): void {
  if (isMultiProfile()) return;
  const existing = readEnvFileAt(dotEnvPath());
  delete existing[PROFILE_KEY];
  writeEnvFileAt(profilePath(DEFAULT_PROFILE), existing);
  writeConfigFile({ currentProfile: DEFAULT_PROFILE });
}

/** Every known profile name. Single-account mode reports the implicit `default`. */
export function listProfileNames(): string[] {
  if (!isMultiProfile()) return [DEFAULT_PROFILE];
  let entries: string[];
  try {
    entries = readdirSync(profilesDir());
  } catch {
    return [currentProfileName()];
  }
  const names = entries
    .filter((entry) => entry.endsWith(".env"))
    .map((entry) => basename(entry, ".env"));
  // The active profile is always listed, even if its file was deleted by hand.
  if (!names.includes(currentProfileName())) names.push(currentProfileName());
  return names.sort();
}

/** Stored credentials for one profile, without touching the active target. */
export function readProfile(name: string): Record<string, string> {
  const values = isMultiProfile() ? readEnvFileAt(profilePath(name)) : readEnvFileAt(dotEnvPath());
  delete values[PROFILE_KEY];
  return values;
}

/**
 * Make `name` the active profile and rewrite the `.env` mirror from it, so the
 * skill / curl / SDK path switches accounts along with the CLI.
 */
export function setCurrentProfile(name: string): void {
  assertValidProfileName(name);
  ensureProfilesInitialized();
  const path = profilePath(name);
  if (!existsSync(path)) {
    throw new Error(
      `Unknown profile "${name}". Run \`busabase-cli auth status\` to list profiles, or \`busabase-cli login --profile ${name}\` to create it.`,
    );
  }
  writeConfigFile({ currentProfile: name });
  const values = readEnvFileAt(path);
  delete values[PROFILE_KEY];
  writeEnvFileAt(dotEnvPath(), { ...values, [PROFILE_KEY]: name });
}

/** Update one key of a profile in place, refreshing the mirror when it is active. */
export function updateProfileValues(name: string, updates: Record<string, string | null>): void {
  ensureProfilesInitialized();
  const path = profilePath(name);
  const merged = { ...readEnvFileAt(path) };
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  delete merged[PROFILE_KEY];
  writeEnvFileAt(path, merged);
  if (name === currentProfileName()) {
    writeEnvFileAt(dotEnvPath(), { ...merged, [PROFILE_KEY]: name });
  }
}

/** Delete a profile. The active one cannot be removed — switch away first. */
export function removeProfile(name: string): void {
  assertValidProfileName(name);
  if (!isMultiProfile()) {
    throw new Error("Only one account is configured — nothing to remove. Use `logout` instead.");
  }
  if (name === currentProfileName()) {
    throw new Error(
      `"${name}" is the active profile. Switch to another one first: \`busabase-cli auth switch <name>\`.`,
    );
  }
  const path = profilePath(name);
  if (!existsSync(path)) throw new Error(`Unknown profile "${name}".`);
  rmSync(path);
}
