import {
  BUSABASE_AGENT_HEADER,
  normalizeAgentClient,
} from "busabase-contract/contract/agent-client";

type Env = Record<string, string | undefined>;

const isSet = (value: string | undefined) => {
  const trimmed = value?.trim().toLowerCase();
  return Boolean(trimmed) && trimmed !== "0" && trimmed !== "false";
};

/**
 * Environment markers each agent puts on the commands it runs. Checked in
 * order; only markers backed by evidence are listed:
 * - Claude Code: `CLAUDECODE=1` (measured in a command Claude Code ran).
 * - Codex CLI: `CODEX_SESSION_ID` / `CODEX_THREAD_ID` (measured, Codex 0.163).
 * - OpenCode: `OPENCODE=1` (its shell tool sets it — packages/core/src/tool/plugin/shell.ts).
 * - Gemini CLI: `GEMINI_CLI=1` (ShellExecutionService, @google/gemini-cli-core 0.65).
 * - Pi: `PI_CODING_AGENT=true` (set in its own process, inherited by its bash
 *   tool; @mariozechner/pi-coding-agent 0.73).
 * Anything else is left to the generic `AI_AGENT` or the `BUSABASE_AGENT` override.
 */
const AGENT_MARKERS: ReadonlyArray<{ id: string; vars: readonly string[] }> = [
  { id: "claude-code", vars: ["CLAUDECODE"] },
  { id: "codex", vars: ["CODEX_SESSION_ID", "CODEX_THREAD_ID"] },
  { id: "opencode", vars: ["OPENCODE"] },
  { id: "gemini-cli", vars: ["GEMINI_CLI"] },
  { id: "pi", vars: ["PI_CODING_AGENT"] },
];

const normalizedId = (value: string | undefined) => normalizeAgentClient(value)?.id;

/**
 * Which agent client is running this CLI, as the id sent in `x-busabase-agent`.
 * Precedence: an explicit `BUSABASE_AGENT` → a specific agent's marker → the
 * cross-tool `AI_AGENT` convention (`<tool>_<version>_agent`) → none.
 * Self-reported attribution only — it labels the change, it grants nothing.
 */
export const detectAgentClient = (env: Env): string | undefined => {
  const explicit = normalizedId(env.BUSABASE_AGENT);
  if (explicit) return explicit;
  for (const marker of AGENT_MARKERS) {
    if (marker.vars.some((name) => isSet(env[name]))) return marker.id;
  }
  return normalizedId(env.AI_AGENT);
};

/** The request header for the detected agent client, or undefined when there is none. */
export const agentClientHeaders = (env: Env): Record<string, string> | undefined => {
  const agent = detectAgentClient(env);
  return agent ? { [BUSABASE_AGENT_HEADER]: agent } : undefined;
};
