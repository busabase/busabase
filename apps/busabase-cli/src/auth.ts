import { createInterface } from "node:readline/promises";
import {
  currentProfileName,
  DEFAULT_PROFILE,
  ensureProfilesInitialized,
  isMultiProfile,
  listProfileNames,
  loadConfigFile,
  readProfile,
  removeProfile,
  setCurrentProfile,
  updateProfileValues,
  writeConfigFile,
  writeDotEnvFile,
} from "./config-file.js";
import type { OutputFormat } from "./format.js";

/**
 * `busabase-cli auth …` — account (profile) management.
 *
 * Verbs follow `gh` (`login` / `logout` / `status` / `switch`) because this CLI
 * already had `login`/`logout`. Storage is deliberately flat — one profile per
 * account, with `baseUrl` as just another field — so "several hosts" and "several
 * accounts on one host" are the same thing and need no second level of nesting.
 * `auth status` only *displays* them grouped by host, for readability.
 */

const say = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export interface ProfileStatus {
  profile: string;
  active: boolean;
  baseUrl: string;
  spaceId: string;
  /** How this profile authenticates: a refreshable OAuth set, a static key, or nothing. */
  credential: "oauth" | "api_key" | "none";
  /** OAuth access-token expiry (ISO), when one is stored. */
  expiresAt?: string;
}

const UNSET = "(not set)";

export function collectProfileStatus(): ProfileStatus[] {
  const active = currentProfileName();
  return listProfileNames().map((profile) => {
    const values = readProfile(profile);
    const expiresAt = values.BUSABASE_TOKEN_EXPIRES_AT;
    const credential = !values.BUSABASE_API_KEY ? "none" : expiresAt ? "oauth" : "api_key";
    return {
      profile,
      active: profile === active,
      baseUrl: values.BUSABASE_BASE_URL ?? UNSET,
      spaceId: values.BUSABASE_SPACE_ID ?? UNSET,
      credential,
      ...(expiresAt ? { expiresAt } : {}),
    };
  });
}

function describeCredential(status: ProfileStatus): string {
  if (status.credential === "none") return "no auth";
  if (status.credential === "api_key") return "API key";
  if (!status.expiresAt) return "OAuth";
  const remainingMs = Date.parse(status.expiresAt) - Date.now();
  if (Number.isNaN(remainingMs)) return "OAuth";
  if (remainingMs <= 0) return "OAuth, EXPIRED — run `busabase-cli login`";
  const days = Math.floor(remainingMs / 86_400_000);
  if (days >= 1) return `OAuth, expires in ${days}d`;
  const hours = Math.max(1, Math.floor(remainingMs / 3_600_000));
  return `OAuth, expires in ${hours}h`;
}

/** Warn when an exported env var silently outranks whatever the files say. */
function envOverrideNotes(): string[] {
  const notes: string[] = [];
  const envProfile = process.env.BUSABASE_PROFILE;
  if (envProfile && envProfile !== currentProfileName()) {
    notes.push(
      `BUSABASE_PROFILE=${envProfile} is exported — commands use that profile, not the active one above.`,
    );
  }
  for (const key of ["BUSABASE_API_KEY", "BUSABASE_BASE_URL", "BUSABASE_SPACE_ID"]) {
    if (process.env[key]) notes.push(`${key} is exported — it overrides the stored value.`);
  }
  if (process.env.BUSABASE_CONFIG) {
    notes.push(
      `BUSABASE_CONFIG=${process.env.BUSABASE_CONFIG} is exported — profiles are bypassed.`,
    );
  }
  return notes;
}

/** Render `auth status`: grouped by host for reading, flat in storage. */
export function renderAuthStatus(statuses: ProfileStatus[]): string {
  const byHost = new Map<string, ProfileStatus[]>();
  for (const status of statuses) {
    const bucket = byHost.get(status.baseUrl);
    if (bucket) bucket.push(status);
    else byHost.set(status.baseUrl, [status]);
  }

  const nameWidth = Math.max(...statuses.map((s) => s.profile.length), 4);
  const spaceWidth = Math.max(...statuses.map((s) => s.spaceId.length), 5);
  const lines: string[] = [];
  for (const [host, group] of byHost) {
    lines.push(host);
    for (const status of group) {
      lines.push(
        `  ${status.active ? "*" : " "} ${status.profile.padEnd(nameWidth)}  ${status.spaceId.padEnd(spaceWidth)}  (${describeCredential(status)})`,
      );
    }
  }

  if (!isMultiProfile()) {
    lines.push("");
    lines.push("Single account. `busabase-cli login --profile <name>` adds another.");
  }
  const notes = envOverrideNotes();
  if (notes.length > 0) {
    lines.push("");
    for (const note of notes) lines.push(`! ${note}`);
  }
  return lines.join("\n");
}

export function runAuthStatus(output: OutputFormat): string {
  const statuses = collectProfileStatus();
  if (output === "json") return JSON.stringify(statuses, null, 2);
  return renderAuthStatus(statuses);
}

export interface AuthSwitchOptions {
  /** Target profile; omitted means "pick one" (or "just change the space"). */
  name?: string;
  /** `--space-id`: retarget the space without re-authenticating. */
  spaceId?: string;
  /** False in tests / CI — never prompt. */
  interactive?: boolean;
}

/**
 * Switch the active account, and/or repoint the current profile at another space.
 *
 * Space lives in the profile, not in `config.json`: a key is only valid for the
 * spaces its account can see, so a globally-stored space would hand profile A's
 * key profile B's space and 403. This mirrors kubectl (namespace lives in the
 * context) and gcloud (project lives in the configuration).
 */
export async function runAuthSwitch(options: AuthSwitchOptions): Promise<Record<string, string>> {
  const interactive = options.interactive ?? process.stdin.isTTY === true;
  let name = options.name;

  if (!name && options.spaceId) {
    // `auth switch --space-id X` alone: retarget the profile already in use.
    const active = currentProfileName();
    applySpace(active, options.spaceId);
    return {
      status: "space changed",
      profile: active,
      spaceId: options.spaceId,
    };
  }

  if (!name) {
    const names = listProfileNames();
    if (names.length <= 1) {
      throw new Error(
        "Only one account is configured. Add another with `busabase-cli login --profile <name>`.",
      );
    }
    const others = names.filter((candidate) => candidate !== currentProfileName());
    if (others.length === 1) {
      // Exactly two accounts — the intent is unambiguous, so don't ask (gh does the same).
      name = others[0];
    } else if (!interactive) {
      throw new Error(
        `Several profiles available (${names.join(", ")}). Pass a name: \`busabase-cli auth switch <name>\`.`,
      );
    } else {
      say("Profiles:");
      for (const [index, candidate] of names.entries()) {
        const marker = candidate === currentProfileName() ? "*" : " ";
        say(`  ${index + 1}) ${marker} ${candidate}`);
      }
      const answer = await ask("Switch to which profile? (number or name) ");
      // Pressing enter is "never mind", not a request to switch to the empty profile.
      if (!answer) throw new Error("Nothing selected — the active account is unchanged.");
      const byIndex = Number(answer);
      name =
        Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= names.length
          ? names[byIndex - 1]
          : answer;
      if (!name || !names.includes(name)) throw new Error(`Unknown profile "${answer}".`);
    }
  }

  setCurrentProfile(name);
  if (options.spaceId) applySpace(name, options.spaceId);

  const values = readProfile(name);
  say(`✓ Switched to "${name}" — ~/.busabase/.env now holds this account.`);
  return {
    status: "switched",
    profile: name,
    baseUrl: values.BUSABASE_BASE_URL ?? UNSET,
    spaceId: values.BUSABASE_SPACE_ID ?? UNSET,
  };
}

function applySpace(profile: string, spaceId: string): void {
  updateProfileValues(profile, { BUSABASE_SPACE_ID: spaceId });
}

// ── Spaces within one account ────────────────────────────────────────────────
//
// One account commonly spans several spaces — that is the normal case on Busabase
// Cloud, while a self-hosted/open-source server reports exactly one. Switching
// spaces is therefore far more frequent than switching accounts (the same reason
// kubectl users reach for `kubens` more often than they change clusters), so it
// gets first-class commands instead of making anyone paste a raw space id.
//
// `GET /api/v1/auth` already returns every space the credential can see, so this
// needs no new endpoint — and it doubles as validation: you can only select a
// space the current account actually belongs to, never one that would 403 later.

export interface VerifiedSpace {
  id: string;
  name: string;
  slug: string | null;
  plan?: string | null;
}

export interface VerifiedAuth {
  /** Space this credential resolves to right now (explicit target, else the server default). */
  space: VerifiedSpace;
  /** Every space the authenticated user belongs to. */
  spaces: VerifiedSpace[];
}

export interface SpaceEntry extends VerifiedSpace {
  active: boolean;
}

export function collectSpaces(auth: VerifiedAuth, targetedSpaceId?: string): SpaceEntry[] {
  const activeId = targetedSpaceId ?? auth.space?.id;
  const spaces = auth.spaces?.length ? auth.spaces : auth.space ? [auth.space] : [];
  return spaces.map((space) => ({ ...space, active: space.id === activeId }));
}

export function renderSpaceList(entries: SpaceEntry[]): string {
  if (entries.length === 0) return "(no spaces — is this credential still valid?)";
  const nameWidth = Math.max(...entries.map((entry) => entry.name.length), 4);
  const lines = entries.map(
    (entry) =>
      `${entry.active ? "*" : " "} ${entry.name.padEnd(nameWidth)}  ${entry.id}${entry.slug ? `  (${entry.slug})` : ""}`,
  );
  if (entries.length === 1) {
    lines.push("");
    lines.push("This server exposes a single space (self-hosted / open source).");
  }
  return lines.join("\n");
}

export function runSpaceList(
  auth: VerifiedAuth,
  targetedSpaceId: string | undefined,
  output: OutputFormat,
): unknown {
  const entries = collectSpaces(auth, targetedSpaceId);
  return output === "json" ? entries : renderSpaceList(entries);
}

/** Resolve a user-typed selector against the account's spaces: id, slug, then name. */
export function findSpace(entries: SpaceEntry[], selector: string): SpaceEntry {
  const needle = selector.trim();
  const exactId = entries.find((entry) => entry.id === needle);
  if (exactId) return exactId;
  const lowered = needle.toLowerCase();
  const matches = entries.filter(
    (entry) =>
      entry.slug?.toLowerCase() === lowered ||
      entry.name.toLowerCase() === lowered ||
      entry.id.toLowerCase() === lowered,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `"${selector}" matches several spaces (${matches.map((m) => m.id).join(", ")}). Use the space id.`,
    );
  }
  throw new Error(
    `No space named "${selector}" on this account. Available: ${entries.map((entry) => entry.name).join(", ")}.`,
  );
}

export interface SpaceUseOptions {
  auth: VerifiedAuth;
  targetedSpaceId?: string;
  /** Space id, slug or name; omitted means prompt. */
  selector?: string;
  interactive?: boolean;
}

/**
 * Point the active account at another of its spaces. Writes only
 * `BUSABASE_SPACE_ID`, through the same target the rest of this invocation uses —
 * so it lands in the right profile (and refreshes the `.env` mirror) without
 * touching the credential itself.
 */
export async function runSpaceUse(options: SpaceUseOptions): Promise<Record<string, string>> {
  const interactive = options.interactive ?? process.stdin.isTTY === true;
  const entries = collectSpaces(options.auth, options.targetedSpaceId);
  if (entries.length === 0) throw new Error("This credential can't see any space.");

  let chosen: SpaceEntry;
  if (options.selector) {
    chosen = findSpace(entries, options.selector);
  } else if (entries.length === 1) {
    chosen = entries[0];
  } else if (!interactive) {
    throw new Error(
      `Several spaces available (${entries.map((entry) => entry.name).join(", ")}). Pass one: \`busabase-cli space use <name|id>\`.`,
    );
  } else {
    say("Spaces:");
    for (const [index, entry] of entries.entries()) {
      say(`  ${index + 1}) ${entry.active ? "*" : " "} ${entry.name}  ${entry.id}`);
    }
    const answer = await ask("Use which space? (number, name or id) ");
    if (!answer) throw new Error("Nothing selected — the targeted space is unchanged.");
    const byIndex = Number(answer);
    chosen =
      Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= entries.length
        ? entries[byIndex - 1]
        : findSpace(entries, answer);
  }

  writeDotEnvFile({ BUSABASE_SPACE_ID: chosen.id });
  say(`✓ Now targeting space "${chosen.name}" (${chosen.id}).`);
  return {
    status: "space selected",
    profile: currentProfileName(),
    space: chosen.name,
    spaceId: chosen.id,
  };
}

export function runAuthRemove(name: string): Record<string, string> {
  removeProfile(name);
  say(`✓ Removed profile "${name}".`);
  return { status: "removed", profile: name };
}

const SETTING_KEYS = new Set(["output"]);
const OUTPUT_VALUES = new Set<string>(["text", "table", "json"]);

/**
 * `auth config set <key> <value>` — user preferences that survive an account
 * switch. The test for belonging here: "is this still true as a different user?"
 * Yes → `config.json`. No (baseUrl / apiKey / spaceId) → the profile.
 */
export function runAuthConfigSet(key: string, value: string): Record<string, string> {
  if (!SETTING_KEYS.has(key)) {
    throw new Error(`Unknown setting "${key}". Known settings: ${[...SETTING_KEYS].join(", ")}.`);
  }
  if (key === "output" && !OUTPUT_VALUES.has(value)) {
    throw new Error(
      `Invalid output "${value}". Expected one of: ${[...OUTPUT_VALUES].join(", ")}.`,
    );
  }
  // Preferences must not drag an untouched install into multi-account mode.
  writeConfigFile({ [key]: value });
  return { status: "saved", [key]: value };
}

export function runAuthConfigList(): Record<string, string> {
  const config = loadConfigFile();
  return {
    output: config.output ?? "text (default)",
    currentProfile: config.currentProfile ?? `${DEFAULT_PROFILE} (implicit — single account)`,
  };
}

/** Called by `login --profile <name>`: create the profile and make it active. */
export function activateLoggedInProfile(name: string): void {
  ensureProfilesInitialized();
  setCurrentProfile(name);
}
