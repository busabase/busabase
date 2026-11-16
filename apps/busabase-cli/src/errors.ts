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

import { shouldRetry } from "./retry.js";

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

export interface CliErrorFinding {
  path: string;
  ruleName: string;
}

export interface ErrorRequestContext {
  request?: {
    method: string;
    status?: number;
    requestId?: string;
    priorWrite?: boolean;
    ambiguous?: boolean;
  };
  intendedMethod?: string;
}

export interface ClassifiedError {
  code: CliErrorCode;
  /** HTTP status when the failure came from the server; absent for transport errors. */
  status?: number;
  message: string;
  issues?: CliErrorIssue[];
  serverCode?: string;
  findings?: CliErrorFinding[];
  requestId?: string;
  /**
   * Whether repeating the identical request could plausibly succeed. `429`, `5xx`
   * and transport failures are; a `404` or a schema refusal is not, and retrying
   * one is just a slower way to fail.
   */
  retryable: boolean;
  /** Whether replaying this request is safe AND could help; unlike retryable, method-aware. */
  safeToRetry: boolean;
  writeOutcome?: "not_sent" | "rejected" | "unknown";
  exitCode: number;
  /**
   * Agent-facing recovery: the exact next command to run, fully assembled for
   * this connection (base URL, profile). Attached by the CLI's error path — see
   * `authRecoveryHint` in `login.ts` — not derived here, because classification
   * has no access to the resolved config.
   */
  hint?: string;
}

/** The JSON written to stdout when `--output json` is set and the command failed. */
export interface CliErrorEnvelope {
  ok: false;
  code: CliErrorCode;
  status?: number;
  message: string;
  issues?: CliErrorIssue[];
  serverCode?: string;
  findings?: CliErrorFinding[];
  requestId?: string;
  retryable: boolean;
  safeToRetry: boolean;
  writeOutcome?: "not_sent" | "rejected" | "unknown";
  hint?: string;
}

const RETRYABLE: ReadonlySet<CliErrorCode> = new Set(["RATE_LIMITED", "SERVER_ERROR", "NETWORK"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const serverCode = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value) ? value : undefined;

export function toFindings(raw: unknown): CliErrorFinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const findings = raw.flatMap((item): CliErrorFinding[] => {
    if (!item || typeof item !== "object") return [];
    const { path, ruleName } = item as { path?: unknown; ruleName?: unknown };
    if (
      typeof path !== "string" ||
      !path ||
      typeof ruleName !== "string" ||
      !/^[a-zA-Z0-9_-]{1,120}$/.test(ruleName)
    ) {
      return [];
    }
    return [
      {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal and bidirectional controls from diagnostic paths.
        path: path.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ""),
        ruleName,
      },
    ];
  });
  return findings.length ? findings : undefined;
}

/** Share the same allowlist with the raw transport and the typed SDK's errors. */
function safeErrorDetails(error: unknown, httpStatus?: number) {
  const value = error as {
    status?: unknown;
    code?: unknown;
    data?: { findings?: unknown; issues?: unknown };
  };
  const code =
    httpStatus !== undefined || typeof value?.status === "number"
      ? serverCode(value?.code)
      : undefined;
  const findings = toFindings(value?.data?.findings);
  const issues = code === "SECRET_DETECTED" ? undefined : toIssues(value?.data?.issues);
  return {
    ...(code ? { serverCode: code } : {}),
    ...(findings ? { findings } : {}),
    ...(issues ? { issues } : {}),
  };
}

/** Longest raw error body kept in a message; the full text is rarely more useful. */
const RAW_BODY_LIMIT = 500;

/** A raw HTTP failure retains only diagnostic fields safe for CLI output. */
export class CliHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: { issues?: CliErrorIssue[]; findings?: CliErrorFinding[] };

  constructor(status: number, statusText: string, text: string) {
    let body: { error?: unknown; code?: unknown; data?: unknown } | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      // A proxy may return plain text instead of the Busabase error envelope.
    }
    const details = safeErrorDetails(body, status);
    // Scanner findings can sit beside source excerpts, so a body carrying them is
    // never echoed. Any other body (a gateway's `{"message": …}`, a plain-text
    // page) is the only clue to what failed, so it is kept, bounded.
    const carriesFindings =
      (body?.data as { findings?: unknown } | null | undefined)?.findings !== undefined;
    const message =
      details.serverCode === "SECRET_DETECTED"
        ? secretMessage(details.findings)
        : typeof body?.error === "string"
          ? body.error
          : carriesFindings
            ? "Request failed"
            : text.length > RAW_BODY_LIMIT
              ? `${text.slice(0, RAW_BODY_LIMIT)}…`
              : text;
    super(`HTTP ${status} ${statusText}: ${message}`);
    this.name = "CliHttpError";
    this.status = status;
    this.code = details.serverCode;
    this.data = {
      ...(details.issues ? { issues: details.issues } : {}),
      ...(details.findings ? { findings: details.findings } : {}),
    };
  }
}

const secretMessage = (findings?: CliErrorFinding[]): string =>
  `Upload rejected: ${findings?.length ?? "one or more"} file/rule finding(s) detected. Remove the suspected credentials and retry; matched values are never shown.`;

/** Never render arbitrary server error data, including scanner source excerpts. */
export function formatErrorMessage(error: unknown): string {
  const details = safeErrorDetails(error);
  let message =
    details.serverCode === "SECRET_DETECTED"
      ? secretMessage(details.findings)
      : error instanceof Error
        ? error.message
        : String(error);
  const issueDetail = details.issues
    ?.map(({ path, message }) => (path ? `${path}: ${message}` : message))
    .join("; ");
  if (issueDetail && !message.includes(issueDetail)) message += ` — ${issueDetail}`;
  if (details.findings) {
    message += `\n${details.findings.map(({ path, ruleName }) => `  ${path}: ${ruleName}`).join("\n")}`;
  }
  return message;
}

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
 * A transport failure produces no response; a write may already have reached the server.
 * Node reports every one of them as a bare `TypeError: fetch failed` with the
 * real reason on `.cause`, which is why this matches on text rather than type.
 */
const isNetworkFailure = (message: string): boolean =>
  /fetch failed|econnrefused|enotfound|getaddrinfo|econnreset|etimedout|socket hang up|network/i.test(
    message,
  );

/**
 * Compatibility with older callers that kept the status only in an Error message.
 */
const statusFromMessage = (message: string): number | undefined => {
  const match = /\bHTTP (\d{3})\b/.exec(message);
  return match ? Number(match[1]) : undefined;
};

/** Classify any thrown value into the stable shape above. Never throws. */
export function classifyError(error: unknown, context: ErrorRequestContext = {}): ClassifiedError {
  const message = formatErrorMessage(error);
  const outcome = (error as { cliCode?: unknown })?.cliCode;
  if (typeof outcome === "string" && outcome in EXIT_CODES) {
    const code = outcome as CliErrorCode;
    return {
      code,
      message,
      retryable: RETRYABLE.has(code),
      safeToRetry: false,
      ...(code !== "TIMEOUT" &&
      code !== "REVIEW_REJECTED" &&
      !context.request &&
      context.intendedMethod &&
      !READ_METHODS.has(context.intendedMethod.toUpperCase())
        ? { writeOutcome: "not_sent" as const }
        : {}),
      exitCode: EXIT_CODES[code],
    };
  }
  const details = safeErrorDetails(error);
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

  const method = context.request?.ambiguous
    ? undefined
    : (context.request?.method ?? context.intendedMethod);
  const retryable = RETRYABLE.has(code);
  const failedResponse =
    status !== undefined &&
    (status < 200 || status >= 300) &&
    !context.request?.ambiguous &&
    context.request?.status === status;
  const writeOutcome =
    method && !READ_METHODS.has(method.toUpperCase())
      ? !context.request
        ? ("not_sent" as const)
        : status !== undefined && status >= 400 && status < 500 && status !== 408
          ? ("rejected" as const)
          : ("unknown" as const)
      : undefined;
  return {
    code,
    ...(status !== undefined ? { status } : {}),
    message,
    ...details,
    ...(failedResponse && context.request?.requestId
      ? { requestId: context.request.requestId }
      : {}),
    retryable,
    safeToRetry: Boolean(
      retryable &&
        context.request &&
        !context.request.priorWrite &&
        method &&
        shouldRetry(method, status),
    ),
    ...(writeOutcome ? { writeOutcome } : {}),
    exitCode: EXIT_CODES[code],
  };
}

/**
 * Whether a 404 means "this server has no such route", as opposed to a
 * procedure's own NOT_FOUND ("no invite link with that id").
 *
 * The CLI and the server ship separately, so a new command can reach a server
 * that predates its endpoint — or the open-source edition, which never had it.
 * Both servers' `/api/v1` handlers answer an unmatched path with
 * `{ "error": "Not found", "path": … }` and no `code`; busabase-sdk decodes a body
 * without `code` as `HTTP_404`. A procedure's error always carries its `code`
 * (`encodeBusabaseOpenApiError`). Anything that is not a Busabase JSON error at
 * all — an HTML or plain-text 404 from a proxy or a host with no `/api/v1` — is
 * kept by oRPC as the raw `data.body`, and counts as route-missing too.
 */
export function isRouteMissing(error: unknown): boolean {
  const { status, code, data } = (error ?? {}) as {
    status?: unknown;
    code?: unknown;
    data?: unknown;
  };
  if (status !== 404) return false;
  if (code === "HTTP_404") return true;
  if (!data || typeof data !== "object" || !("body" in data)) return false;
  const body = (data as { body?: unknown }).body;
  return !(
    body &&
    typeof body === "object" &&
    typeof (body as { code?: unknown }).code === "string"
  );
}

/** The stdout envelope for a failed command under `--output json`. */
export function errorEnvelope(classified: ClassifiedError): CliErrorEnvelope {
  return {
    ok: false,
    code: classified.code,
    ...(classified.status !== undefined ? { status: classified.status } : {}),
    message: classified.message,
    ...(classified.issues ? { issues: classified.issues } : {}),
    ...(classified.serverCode ? { serverCode: classified.serverCode } : {}),
    ...(classified.findings ? { findings: classified.findings } : {}),
    ...(classified.requestId ? { requestId: classified.requestId } : {}),
    retryable: classified.retryable,
    safeToRetry: classified.safeToRetry,
    ...(classified.writeOutcome ? { writeOutcome: classified.writeOutcome } : {}),
    ...(classified.hint ? { hint: classified.hint } : {}),
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
