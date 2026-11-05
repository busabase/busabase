import { createHash } from "node:crypto";

export const MAX_AGENT_SESSION_COMMAND_BYTES = 16 * 1024 * 1024;
export const MAX_AGENT_SESSION_JOURNAL_BATCH = 256;
export const MAX_AGENT_SESSION_PENDING_COMMANDS = 1_024;

export function agentSessionPendingCommandLimit(): number {
  const raw = process.env.BUSABASE_AGENT_MAX_PENDING_COMMANDS;
  const parsed = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed)
    ? Math.max(2, Math.min(MAX_AGENT_SESSION_PENDING_COMMANDS, Math.floor(parsed)))
    : 128;
}

/** Activation requires an explicit coordinated legacy-worker drain. */
export function agentSessionJournalEnabled(): boolean {
  return (
    process.env.BUSABASE_AGENT_SUPERVISOR_ENABLED === "true" &&
    process.env.BUSABASE_AGENT_LEGACY_WRITERS_DRAINED === "true"
  );
}

/** Deterministic JSON only. This is not text-based event deduplication. */
export function agentSessionCanonicalJson(value: unknown, event = false): string {
  const active = new Set<object>();
  function visit(input: unknown, path: string[]): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Command contains a non-JSON number.");
      return input;
    }
    if (input === undefined) return undefined;
    if (typeof input !== "object") throw new Error("Command must contain JSON values only.");
    if (active.has(input)) throw new Error("Command must not contain circular values.");
    active.add(input);
    try {
      if (Array.isArray(input))
        return input.map((child, index) => visit(child, [...path, String(index)]) ?? null);
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      )
        throw new Error("Command must contain plain JSON objects only.");
      // JSON permits an own __proto__ key. A normal object assignment would
      // invoke the legacy setter and omit that semantic input from the digest.
      const output: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(input).sort()) {
        if (event && path.length === 0 && ["at", "seq", "sessionId"].includes(key)) continue;
        if (event && key === "replay" && path.at(-1) === "buda.im" && path.at(-2) === "_meta")
          continue;
        const child = visit((input as Record<string, unknown>)[key], [...path, key]);
        if (child !== undefined) output[key] = child;
      }
      return output;
    } finally {
      active.delete(input);
    }
  }
  const result = JSON.stringify(visit(value, []));
  if (result === undefined || Buffer.byteLength(result) > MAX_AGENT_SESSION_COMMAND_BYTES)
    throw new Error("Command exceeds the supported JSON size.");
  return result;
}

export function agentSessionCommandDigest(value: unknown): string {
  return createHash("sha256").update(agentSessionCanonicalJson(value)).digest("hex");
}

export function agentSessionEventDigest(value: unknown): string {
  return createHash("sha256").update(agentSessionCanonicalJson(value, true)).digest("hex");
}
