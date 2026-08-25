/**
 * Error classification for callers that are not people.
 *
 * `explainError` (see `./run.ts`) writes prose for a human reading a terminal.
 * That prose is all an agent, a CI step, or a script ever got: every failure —
 * an expired token, a stale id, a malformed payload, a 429 — arrived as exit
 * code `1` with an empty stdout, so the four different recoveries those four
 * failures need were indistinguishable without matching English text.
 *
 * This module is the machine-readable half of the same error: a stable `code`,
 * the HTTP `status` when there was one, whether retrying could plausibly help,
 * and a distinct process exit code per class.
 */

/** Stable, machine-readable class for a failure. Never localized, never reworded. */
export type CliErrorCode =
  | "USAGE"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK"
  | "REVIEW_REJECTED"
  | "TIMEOUT"
  | "ERROR";

/**
 * Process exit code per class.
 *
 * `1` stays the code for an unclassified error, so a script testing `!= 0` is
 * unaffected and only a script testing `== 1` sees a change.
 */
export const EXIT_CODES: Record<CliErrorCode, number> = {
  ERROR: 1,
  USAGE: 2,
  UNAUTHORIZED: 3,
  FORBIDDEN: 3,
  NOT_FOUND: 4,
  VALIDATION: 5,
  CONFLICT: 6,
  RATE_LIMITED: 7,
  SERVER_ERROR: 8,
  NETWORK: 9,
  // `--wait` outcomes. A proposal a human turned down is not a CLI failure, but
  // it is the one thing the caller has to branch on differently from "merged" —
  // and a wait that ran out of budget is different again: nothing was decided,
  // so the right move is to keep waiting, not to give up or retry the write.
  REVIEW_REJECTED: 10,
  TIMEOUT: 11,
};

/** One validation issue, flattened to `path` + `message` the way the server reports it. */
export interface CliErrorIssue {
  path: string;
  message: string;
}

export interface ClassifiedError {
  code: CliErrorCode;
  /** HTTP status when the failure came from the server; absent for transport errors. */
  status?: number;
  message: string;
  issues?: CliErrorIssue[];
  /**
   * Whether repeating the identical request could plausibly succeed. `429`, `5xx`
   * and transport failures are; a `404` or a schema refusal is not, and retrying
   * one is just a slower way to fail.
   */
  retryable: boolean;
  exitCode: number;
}

/** The JSON written to stdout when `--output json` is set and the command failed. */
export interface CliErrorEnvelope {
  ok: false;
  code: CliErrorCode;
  status?: number;
  message: string;
  issues?: CliErrorIssue[];
  retryable: boolean;
}

const RETRYABLE: ReadonlySet<CliErrorCode> = new Set(["RATE_LIMITED", "SERVER_ERROR", "NETWORK"]);

/** `data.issues` as the server sends it, flattened. Shared with `explainError`'s prose rendering. */
export function toIssues(raw: unknown): CliErrorIssue[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const issues = raw.map((issue): CliErrorIssue => {
    if (!issue || typeof issue !== "object") return { path: "", message: String(issue) };
    const { path, message } = issue as { path?: unknown; message?: unknown };
    return {
      path: Array.isArray(path) ? path.join(".") : typeof path === "string" ? path : "",
      message: String(message ?? issue),
    };
  });
  return issues.length > 0 ? issues : undefined;
}

const codeForStatus = (status: number): CliErrorCode => {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status >= 500) return "SERVER_ERROR";
  return "ERROR";
};

/**
 * A transport failure never reaches the server, so it has no status to read.
 * Node reports every one of them as a bare `TypeError: fetch failed` with the
 * real reason on `.cause`, which is why this matches on text rather than type.
 */
const isNetworkFailure = (message: string): boolean =>
  /fetch failed|econnrefused|enotfound|getaddrinfo|econnreset|etimedout|socket hang up|network/i.test(
    message,
  );

/**
 * `rawFetch` (health / openapi / `api` passthrough) throws a plain `Error`
 * carrying `HTTP <status> <statusText>: …` rather than an `ORPCError`, so the
 * status has to be read back out of the message for those paths.
 */
const statusFromMessage = (message: string): number | undefined => {
  const match = /\bHTTP (\d{3})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
};

/** Classify any thrown value into the stable shape above. Never throws. */
export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const outcome = (error as { cliCode?: unknown })?.cliCode;
  if (typeof outcome === "string" && outcome in EXIT_CODES) {
    const code = outcome as CliErrorCode;
    return { code, message, retryable: RETRYABLE.has(code), exitCode: EXIT_CODES[code] };
  }
  const issues = toIssues((error as { data?: { issues?: unknown } })?.data?.issues);
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : statusFromMessage(message);

  let code: CliErrorCode;
  if (status !== undefined) {
    code = codeForStatus(status);
  } else if (isNetworkFailure(message)) {
    code = "NETWORK";
  } else {
    code = "ERROR";
  }

  // An oRPC `code` is the server's own word for the failure and outranks the
  // status when the two disagree — the contract's `BAD_REQUEST` for a schema
  // refusal arrives as 400, which would otherwise read as a generic client error.
  const orpcCode = (error as { code?: unknown })?.code;
  if (code === "ERROR" && typeof orpcCode === "string") {
    if (orpcCode === "NOT_FOUND") code = "NOT_FOUND";
    else if (orpcCode === "UNAUTHORIZED") code = "UNAUTHORIZED";
    else if (orpcCode === "FORBIDDEN") code = "FORBIDDEN";
    else if (orpcCode === "CONFLICT") code = "CONFLICT";
    else if (orpcCode === "BAD_REQUEST" || orpcCode === "UNPROCESSABLE_CONTENT")
      code = "VALIDATION";
    else if (orpcCode === "TOO_MANY_REQUESTS") code = "RATE_LIMITED";
  }

  return {
    code,
    ...(status !== undefined ? { status } : {}),
    message,
    ...(issues ? { issues } : {}),
    retryable: RETRYABLE.has(code),
    exitCode: EXIT_CODES[code],
  };
}

/** The stdout envelope for a failed command under `--output json`. */
export function errorEnvelope(classified: ClassifiedError): CliErrorEnvelope {
  return {
    ok: false,
    code: classified.code,
    ...(classified.status !== undefined ? { status: classified.status } : {}),
    message: classified.message,
    ...(classified.issues ? { issues: classified.issues } : {}),
    retryable: classified.retryable,
  };
}

/**
 * A command that ran fine but ended in an outcome the caller must branch on —
 * a proposal a reviewer turned down, or a `--wait` that ran out of budget.
 *
 * Carries its own class so {@link classifyError} does not have to guess from a
 * message, and so the envelope reports it exactly like any other failure.
 */
export class CliOutcomeError extends Error {
  readonly cliCode: CliErrorCode;

  constructor(cliCode: CliErrorCode, message: string) {
    super(message);
    this.name = "CliOutcomeError";
    this.cliCode = cliCode;
  }
}
