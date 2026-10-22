import { z } from "zod";

/**
 * Agent client attribution — "which agent program made this change".
 *
 * The API key says WHO is accountable (its name, its owner). On one machine,
 * several agents often share one key (`~/.busabase/.env`), so the key alone
 * cannot tell "Claude Code added this" from "Codex added this". A caller names
 * its agent client with ONE request header; busabase-cli detects it from the
 * environment and sends it on every request.
 *
 * It is SELF-REPORTED: a label for people reading the history, never identity,
 * authorization or anything security relevant. The server normalizes it with
 * `normalizeAgentClient` and stores only the normalized `{ id, name }`.
 */
export const BUSABASE_AGENT_HEADER = "x-busabase-agent";

export const AgentClientVOSchema = z.object({
  /** Normalized, lowercase `[a-z0-9-]`, at most 40 characters (e.g. `codex`). */
  id: z.string(),
  /** Display name: a known agent's product name, otherwise derived from the id. */
  name: z.string(),
});
export type AgentClientVO = z.infer<typeof AgentClientVOSchema>;

const MAX_AGENT_ID_CHARS = 40;
/** Longer raw values are not an agent name; don't spend work on them. */
const MAX_RAW_CHARS = 256;

/**
 * Agents whose names we know, keyed by every id they are commonly reported
 * as. Only agents whose environment markers were verified (see busabase-cli
 * `agent-client.ts`) get a canonical entry; anything else still works through
 * the generic path below.
 */
const KNOWN_AGENTS: Record<string, AgentClientVO> = {
  "claude-code": { id: "claude-code", name: "Claude Code" },
  claudecode: { id: "claude-code", name: "Claude Code" },
  codex: { id: "codex", name: "Codex" },
  "codex-cli": { id: "codex", name: "Codex" },
  "openai-codex": { id: "codex", name: "Codex" },
  opencode: { id: "opencode", name: "OpenCode" },
  "gemini-cli": { id: "gemini-cli", name: "Gemini CLI" },
  gemini: { id: "gemini-cli", name: "Gemini CLI" },
  pi: { id: "pi", name: "Pi" },
  "pi-coding-agent": { id: "pi", name: "Pi" },
};

/**
 * `AI_AGENT` is a cross-tool convention shaped `<tool>_<version>_agent`
 * (Claude Code: `claude-code_2-1-304_agent`); some tools set just `<tool>`
 * (OpenCode: `opencode`). Keep the tool part.
 */
const stripAiAgentConvention = (value: string): string => {
  const match = /^([^_]+)_[^_]*_agent$/.exec(value);
  return match?.[1] ?? value;
};

const toDisplayName = (id: string) =>
  id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/**
 * Normalize a self-reported agent client (the `x-busabase-agent` header, or a
 * raw `AI_AGENT` value) to `{ id, name }`, or null when there is nothing
 * usable. Known agents map to their product name; anything else is reduced to
 * a lowercase `[a-z0-9-]` id of at most 40 characters with a name derived from
 * it — so the output never carries markup, whitespace or control characters.
 */
export const normalizeAgentClient = (raw: string | null | undefined): AgentClientVO | null => {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed.length > MAX_RAW_CHARS) return null;
  const id = stripAiAgentConvention(trimmed.toLowerCase())
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_AGENT_ID_CHARS)
    .replace(/^-+|-+$/g, "");
  if (!id) return null;
  return KNOWN_AGENTS[id] ?? { id, name: toDisplayName(id) };
};
