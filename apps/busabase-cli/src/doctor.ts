import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `busabase-cli doctor` — one command that answers "can this machine talk to
 * Busabase, and if not, what exactly is wrong".
 *
 * The information already existed, scattered across four commands that each
 * answer a different sliver: `health` (is the server up), `whoami` (is my key
 * good), `auth status` (what is stored locally), `space list` (what can I see).
 * None of them answers the question a stuck user actually has, and the command
 * whose name suggests it does — `check` — is a linter for template packages on
 * disk, not a check of the environment at all.
 *
 * Two rules this module exists to enforce, both learned from tools that got them
 * wrong:
 *
 * 1. **Every finding says how it was obtained.** A doctor that reports a stored
 *    API key as "credential ok" is lying by omission — the key may be revoked.
 *    Each check carries a `probe`: read from disk, proven against the live
 *    server, or inferred from a signal that could be wrong. `apps/acprouter-cli`
 *    established this discipline in its `status` command; it is copied here
 *    deliberately.
 * 2. **Not-checked never renders as passing.** A check that could not run is
 *    `n-a`, shown as `–`, never `✓`. Same principle as `package/check.ts`.
 *
 * And one behavioural rule: **doctor must always produce a report.** No config,
 * no credential, no network, no server — it still prints every line. A
 * diagnostic that fails when things are broken is worthless precisely when it is
 * needed, so every probe here is individually wrapped and degrades to a finding.
 */

export type CheckState = "ok" | "warn" | "fail" | "n-a";

/** How a finding was obtained — the difference between "stored" and "true". */
export type Probe =
  /** Read from this machine's disk or environment. Says nothing about the server. */
  | "local"
  /** Proven by an actual request that came back. */
  | "live"
  /** Derived from a signal that is suggestive rather than authoritative. */
  | "inferred"
  /** Not obtained at all. */
  | "skipped";

export interface DoctorCheck {
  id: string;
  label: string;
  state: CheckState;
  probe: Probe;
  detail: string;
  /** A command the user can run, present only when something needs doing. */
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; fail: number; na: number };
}

// ── File inspection ──────────────────────────────────────────────────────────

/**
 * Three states, not two.
 *
 * Everything else in the CLI collapses "no file" and "file I could not parse"
 * into the same empty object (`loadConfigFile` returns `{}` from its catch, and
 * `loadDotEnvFile` does the same), which is right for normal operation — a
 * missing config is not an error — and exactly wrong for a diagnostic. A user
 * whose `config.json` is corrupt sees "(not set)" today and has no way to learn
 * that the file is right there and unreadable.
 */
export type FileState = "missing" | "unreadable" | "empty" | "present";

export interface FileReport {
  path: string;
  state: FileState;
  /** Keys found, when the file parsed. */
  keys: string[];
  error?: string;
}

export function inspectEnvFile(
  path: string,
  io: { exists: (p: string) => boolean; read: (p: string) => string } = {
    exists: existsSync,
    read: (p) => readFileSync(p, "utf8"),
  },
): FileReport {
  if (!io.exists(path)) return { path, state: "missing", keys: [] };
  let raw: string;
  try {
    raw = io.read(path);
  } catch (error) {
    return { path, state: "unreadable", keys: [], error: (error as Error).message };
  }
  const keys = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]?.trim())
    .filter((key): key is string => Boolean(key));
  return { path, state: keys.length > 0 ? "present" : "empty", keys };
}

export function inspectJsonFile(
  path: string,
  io: { exists: (p: string) => boolean; read: (p: string) => string } = {
    exists: existsSync,
    read: (p) => readFileSync(p, "utf8"),
  },
): FileReport & { parsed?: unknown } {
  if (!io.exists(path)) return { path, state: "missing", keys: [] };
  let raw: string;
  try {
    raw = io.read(path);
  } catch (error) {
    return { path, state: "unreadable", keys: [], error: (error as Error).message };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path, state: "unreadable", keys: [], error: "not a JSON object" };
    }
    const keys = Object.keys(parsed as Record<string, unknown>);
    return { path, state: keys.length > 0 ? "present" : "empty", keys, parsed };
  } catch (error) {
    return { path, state: "unreadable", keys: [], error: (error as Error).message };
  }
}

// ── Edition ──────────────────────────────────────────────────────────────────

export interface EditionGuess {
  edition: "local" | "cloud" | "unknown";
  /** Why we think so — printed verbatim, because the reasoning is the caveat. */
  because: string;
  serverVersion?: string;
}

/**
 * There is no edition field on the wire, so this is a guess and is labelled as
 * one. The two signals: a loopback host is a local install, and Cloud's
 * `/api/health` carries `version`/`buildSha` while the open-source one returns
 * only `{service,status,timestamp}`. That difference is a coincidence of how the
 * two routes were written, not a contract — a future OSS build that adds a
 * version field would flip this answer, which is exactly why the reason travels
 * with the verdict instead of being swallowed.
 */
export function inferEdition(input: {
  baseUrl: string;
  health: Record<string, unknown> | null;
  isLocalHost: (baseUrl: string) => boolean;
}): EditionGuess {
  const version =
    input.health && typeof input.health.version === "string" ? input.health.version : undefined;
  if (input.isLocalHost(input.baseUrl)) {
    return {
      edition: "local",
      because: "the base URL is a loopback address",
      ...(version ? { serverVersion: version } : {}),
    };
  }
  if (!input.health) {
    return { edition: "unknown", because: "the server did not answer, so nothing could be read" };
  }
  if (version) {
    return {
      edition: "cloud",
      because: "the health response carries a version field, which only Cloud returns today",
      serverVersion: version,
    };
  }
  return {
    edition: "local",
    because:
      "the health response has no version field, which is how the open-source server answers (self-hosted on a non-loopback host looks identical)",
  };
}

// ── Agent skill ──────────────────────────────────────────────────────────────

export interface SkillDetection {
  found: boolean;
  /** Every location that holds one — a project copy and a global copy can coexist. */
  paths: string[];
  /** Always undefined for now: SKILL.md has no agreed version field to read. */
  version?: string;
}

/**
 * Looks in the same four places `busabase-cli skill install` writes to, so the
 * two commands cannot disagree about where a skill "is".
 */
export function detectInstalledSkill(input: {
  cwd: string;
  home: string;
  exists: (path: string) => boolean;
}): SkillDetection {
  // Deduplicated because running from your home directory makes the project and
  // global candidates the same path, and reporting one file as two installs
  // reads like a conflict that isn't there.
  const candidates = [
    ...new Set([
      join(input.cwd, ".agents", "skills", "busabase", "SKILL.md"),
      join(input.cwd, ".claude", "skills", "busabase", "SKILL.md"),
      join(input.home, ".agents", "skills", "busabase", "SKILL.md"),
      join(input.home, ".claude", "skills", "busabase", "SKILL.md"),
    ]),
  ];
  const paths = candidates.filter((path) => input.exists(path));
  return { found: paths.length > 0, paths };
}

// ── MCP ──────────────────────────────────────────────────────────────────────

export interface McpDetection {
  found: boolean;
  paths: string[];
  /** Files that exist but could not be parsed — reported, never silently skipped. */
  broken: Array<{ path: string; error: string }>;
  /** The locations searched, so "not found" can be read as the narrow claim it is. */
  searched: string[];
}

/**
 * Only two locations are searched: Claude Code's `~/.claude.json` and a project
 * `.mcp.json`. Every other agent host keeps its MCP config somewhere this does
 * not know about, so a negative result means "not in the two places I looked",
 * and the renderer must say so rather than claim MCP is unconfigured.
 */
export function detectMcpConfig(input: {
  cwd: string;
  home: string;
  inspect: (path: string) => FileReport & { parsed?: unknown };
}): McpDetection {
  const searched = [join(input.home, ".claude.json"), join(input.cwd, ".mcp.json")];
  const paths: string[] = [];
  const broken: Array<{ path: string; error: string }> = [];
  for (const path of searched) {
    const report = input.inspect(path);
    if (report.state === "missing") continue;
    if (report.state === "unreadable") {
      broken.push({ path, error: report.error ?? "could not be parsed" });
      continue;
    }
    if (hasBusabaseServer(report.parsed)) paths.push(path);
  }
  return { found: paths.length > 0, paths, broken, searched };
}

/**
 * Claude Code nests per-project servers under `projects.<dir>.mcpServers` as well
 * as keeping a top-level `mcpServers`, so both shapes count as configured.
 */
function hasBusabaseServer(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const root = parsed as Record<string, unknown>;
  if (namesBusabase(root.mcpServers)) return true;
  const projects = root.projects;
  if (projects && typeof projects === "object") {
    for (const project of Object.values(projects as Record<string, unknown>)) {
      if (project && typeof project === "object") {
        if (namesBusabase((project as Record<string, unknown>).mcpServers)) return true;
      }
    }
  }
  return false;
}

const namesBusabase = (servers: unknown): boolean =>
  Boolean(servers) &&
  typeof servers === "object" &&
  Object.keys(servers as Record<string, unknown>).some((name) =>
    name.toLowerCase().includes("busabase"),
  );

// ── Aggregation ──────────────────────────────────────────────────────────────

export function summarize(checks: DoctorCheck[]): DoctorReport["summary"] {
  return {
    ok: checks.filter((c) => c.state === "ok").length,
    warn: checks.filter((c) => c.state === "warn").length,
    fail: checks.filter((c) => c.state === "fail").length,
    na: checks.filter((c) => c.state === "n-a").length,
  };
}

/**
 * A warning is something to look at, not a broken machine, so it does not fail
 * the command — scripts that gate on doctor should only stop for a real fault.
 */
export const hasFailure = (checks: DoctorCheck[]): boolean =>
  checks.some((check) => check.state === "fail");

// ── Rendering ────────────────────────────────────────────────────────────────

const GLYPH: Record<CheckState, string> = { ok: "✓", warn: "!", fail: "✗", "n-a": "–" };

const PROBE_NOTE: Record<Probe, string> = {
  local: "read locally",
  live: "checked against the server",
  inferred: "inferred",
  skipped: "not checked",
};

export function renderDoctor(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.label.length), 4);
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(
      `${GLYPH[check.state]} ${check.label.padEnd(width)}  ${check.detail}  [${PROBE_NOTE[check.probe]}]`,
    );
    if (check.fix) lines.push(`${" ".repeat(width + 4)}→ ${check.fix}`);
  }
  const { ok, warn, fail, na } = report.summary;
  lines.push("");
  lines.push(`${ok} ok · ${warn} warning · ${fail} failed · ${na} not checked`);
  if (fail === 0 && warn === 0) lines.push("This machine is ready to use Busabase.");
  return lines.join("\n");
}

/** Locations doctor knows nothing about, stated so absence is not read as proof. */
export const DOCTOR_BLIND_SPOTS = [
  "API key permission level (read / changeRequest / write / manage) — the server does not report it; you find out by being refused",
  "whether this CLI's compiled contract still matches the server's endpoints",
  "MCP configured in any host other than Claude Code",
  "which version of the agent skill is installed — SKILL.md carries no version field yet",
];

export const defaultHome = (): string => homedir();
