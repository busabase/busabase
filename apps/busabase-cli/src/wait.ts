/**
 * `--wait`: block until a submitted proposal is actually decided.
 *
 * Review-first is the product's whole point, so the useful unit of work for a
 * caller is not "the change request was filed" — it is "the change request was
 * merged, or it wasn't". Without this every caller writes the same poll loop
 * against `change-requests get`, and an agent that skips it reports a proposal
 * nobody has looked at as a completed task.
 */

/** Statuses that will not change again on their own. */
const TERMINAL = new Set(["merged", "rejected", "closed", "abandoned"]);

export interface ChangeRequestLike {
  id: string;
  status: string;
}

const isChangeRequest = (value: unknown): value is ChangeRequestLike => {
  if (!value || typeof value !== "object") return false;
  const row = value as { id?: unknown; status?: unknown };
  return typeof row.id === "string" && row.id.startsWith("crq") && typeof row.status === "string";
};

/**
 * Find the change request a command's result is about.
 *
 * The shape differs across the surface — some routes return the change request
 * itself, some wrap it (`{ changeRequest }`), some return the materialized thing
 * with `materialized: false` alongside — so this looks for the id rather than
 * asking every command to declare it.
 */
export function findChangeRequestId(result: unknown): string | undefined {
  if (isChangeRequest(result)) return result.id;
  if (Array.isArray(result)) {
    for (const item of result) {
      const found = findChangeRequestId(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!result || typeof result !== "object") return undefined;
  const row = result as Record<string, unknown>;
  if (typeof row.changeRequestId === "string") return row.changeRequestId;
  for (const key of ["changeRequest", "changeRequests"]) {
    const found = findChangeRequestId(row[key]);
    if (found) return found;
  }
  return undefined;
}

export type WaitOutcome =
  | { kind: "settled"; status: string; changeRequest: unknown }
  | { kind: "timeout"; status: string; changeRequest: unknown };

export interface WaitOptions {
  changeRequestId: string;
  /** Reads one change request. */
  read: (changeRequestId: string) => Promise<unknown>;
  /** Total budget in milliseconds. */
  timeoutMs: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  notify?: (message: string) => void;
}

const DEFAULT_POLL_MS = 3_000;

/** Poll until the change request settles or the budget runs out. */
export async function waitForChangeRequest(options: WaitOptions): Promise<WaitOutcome> {
  const {
    changeRequestId,
    read,
    timeoutMs,
    pollMs = DEFAULT_POLL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    notify = () => {},
  } = options;
  const deadline = now() + timeoutMs;
  let latest: unknown;
  let status = "unknown";
  for (;;) {
    latest = await read(changeRequestId);
    status = isChangeRequest(latest) ? latest.status : "unknown";
    if (TERMINAL.has(status)) return { kind: "settled", status, changeRequest: latest };
    const remaining = deadline - now();
    if (remaining <= 0) return { kind: "timeout", status, changeRequest: latest };
    notify(
      `[busabase-cli] ${changeRequestId} is ${status}; waiting for a reviewer (${Math.round(
        remaining / 1000,
      )}s left)`,
    );
    await sleep(Math.min(pollMs, remaining));
  }
}

export const isTerminalStatus = (status: string): boolean => TERMINAL.has(status);
