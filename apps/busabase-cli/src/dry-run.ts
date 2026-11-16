/**
 * `--dry-run` — show the write this command would send, and send nothing.
 *
 * Interception happens at the **transport**, not per command: every path into
 * the server (the typed oRPC client, the curated task commands, and `rawFetch`
 * behind `api` / `openapi` / `health`) goes through `config.fetch`, so one wrapper
 * covers all of them and cannot be forgotten when a command is added.
 *
 * Reads pass straight through. That is deliberate: a write command usually has to
 * resolve a slug or read a parent first, and those lookups are exactly what makes
 * the printed plan concrete. Only the first mutating request is stopped — by then
 * this request is resolved; later steps have not been planned or validated.
 *
 * The wrapper goes OUTSIDE `withRetry`, so the interception never reaches the
 * retry layer and can never be mistaken for a transient failure worth repeating.
 */

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Methods that change nothing, and so run for real even under `--dry-run`. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface DryRunPlan {
  method: string;
  url: string;
  /** Parsed request body when it was JSON; the raw string when it was not. */
  body?: unknown;
}

/**
 * Thrown by {@link dryRunFetch} instead of performing a write. Carries the plan
 * so the caller can print it. Deliberately not an `Error` subclass that any retry
 * or transient-failure predicate would match — see `retry.ts`'s `isTransientError`.
 */
export class DryRunInterception extends Error {
  readonly plan: DryRunPlan;

  constructor(plan: DryRunPlan) {
    super(`dry run: ${plan.method} ${plan.url} was not sent`);
    this.name = "DryRunInterception";
    this.plan = plan;
  }
}

const readBody = (init?: RequestInit): unknown => {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body !== "string") return `<${typeof body} body>`;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

/** Wrap a fetch so the first mutating request throws {@link DryRunInterception}. */
export function dryRunFetch(inner: FetchLike): FetchLike {
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (READ_METHODS.has(method)) return inner(input, init);
    const url = request?.url ?? String(input);
    throw new DryRunInterception({ method, url, body: readBody(init) });
  };
}

/** What a human (or an agent) sees instead of the write happening. */
export function renderDryRunPlan(plan: DryRunPlan): string {
  const lines = [
    "[busabase-cli] --dry-run: no write was sent. This is the first suppressed request:",
    "  Server validation was not run: permissions, secret scanning and concurrency checks remain unchecked.",
    "  Later steps in a multi-step command have not been validated.",
    `  ${plan.method} ${plan.url}`,
  ];
  if (plan.body !== undefined) {
    lines.push("  body:", JSON.stringify(plan.body, null, 2));
  }
  return lines.join("\n");
}

/**
 * Note printed when `--dry-run` was asked for but the command never tried to
 * write. Silence would read as "the write was suppressed"; it was not — the
 * output the command printed is real data from a real read.
 */
export const DRY_RUN_NO_WRITE_NOTE =
  "[busabase-cli] --dry-run: this command sent no write, so nothing was suppressed — the output above is real.";

/** The last request a command sent, used to name the endpoint an error came from. */
export interface ObservedRequest {
  method: string;
  pathname: string;
  status?: number;
  requestId?: string;
  /** An earlier request in this command already completed a write. */
  priorWrite?: boolean;
  /** Overlapping requests prevent attributing a thrown error to the last request. */
  ambiguous?: boolean;
}

/**
 * Record every request's method and path. A curated task command may call several
 * endpoints, so the one that actually failed is only knowable from the wire —
 * which is what lets a `403` name the endpoint (and its required permission level)
 * for tasks too, not just for the generated endpoint commands.
 */
export function observeRequests(
  inner: FetchLike,
  sink: (seen: ObservedRequest) => void,
): FetchLike {
  let writeCompleted = false;
  let activeRequests = 0;
  let ambiguous = false;
  let lastSeen: ObservedRequest | undefined;
  return async (input, init) => {
    activeRequests += 1;
    // Once requests overlap, later failures cannot reliably identify one request.
    // Keep the whole command conservative rather than attach a misleading request ID.
    if (activeRequests > 1) ambiguous = true;
    if (ambiguous && lastSeen) lastSeen.ambiguous = true;
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    let seen: ObservedRequest | undefined;
    try {
      seen = {
        method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
        pathname: new URL(url).pathname,
        ...(writeCompleted ? { priorWrite: true } : {}),
        ...(ambiguous ? { ambiguous: true } : {}),
      };
      lastSeen = seen;
      sink(seen);
    } catch {
      // A non-absolute URL is not worth failing the request over.
    }
    try {
      const response = await inner(input, init);
      if (seen) {
        seen.status = response.status;
        const requestId = response.headers.get("x-request-id");
        if (requestId && /^[a-zA-Z0-9._:/-]{1,200}$/.test(requestId)) seen.requestId = requestId;
        if (response.ok && !READ_METHODS.has(seen.method)) writeCompleted = true;
      }
      return response;
    } finally {
      activeRequests -= 1;
    }
  };
}
