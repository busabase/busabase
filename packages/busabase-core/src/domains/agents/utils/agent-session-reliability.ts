import type {
  AgentSessionCommandReceiptVO,
  AgentSessionReliabilityVO,
} from "busabase-contract/domains/agents/types";

/**
 * One failed draft is retained, rather than a map of base64 snapshots for every
 * visited conversation. This is a local retry identity, never a content-based
 * deduplication key: a confirmed acceptance retires it before the next send.
 */
export function createAgentPromptIdentityTracker(
  createIdentity: () => string = () => `cmd_${crypto.randomUUID()}`,
) {
  let pending: { sessionId: string; snapshot: string; commandId: string } | undefined;
  return {
    forAttempt(sessionId: string, input: unknown): string {
      const snapshot = JSON.stringify(input, (_key, value: unknown) => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          return Object.fromEntries(
            Object.keys(record)
              .sort()
              .map((key) => [key, record[key]]),
          );
        }
        return value;
      });
      if (pending?.sessionId === sessionId && pending.snapshot === snapshot)
        return pending.commandId;
      pending = { sessionId, snapshot, commandId: createIdentity() };
      return pending.commandId;
    },
    accepted(commandId: string): void {
      if (pending?.commandId === commandId) pending = undefined;
    },
  };
}

export function pendingAgentPromptCommands(
  commands: readonly AgentSessionCommandReceiptVO[] | undefined,
  committedCommandIds: ReadonlySet<string>,
): AgentSessionCommandReceiptVO[] {
  return (commands ?? []).filter(
    (command) =>
      command.kind === "prompt" &&
      command.state !== "completed" &&
      !committedCommandIds.has(command.commandId),
  );
}

export function isSupervisedPromptBlocked(
  reliability: AgentSessionReliabilityVO | undefined,
): boolean {
  return Boolean(
    reliability &&
      (reliability.execution === "unknown" ||
        reliability.execution === "terminal" ||
        reliability.synchronization === "gap"),
  );
}

/** Authorization/deletion errors must never reuse a formerly authorized view. */
export function isAgentSessionAccessError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return (
    ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(String(failure.code)) ||
    [401, 403, 404].includes(Number(failure.status ?? failure.statusCode))
  );
}
