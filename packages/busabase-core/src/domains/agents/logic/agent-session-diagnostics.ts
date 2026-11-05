import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";

/** Correlation is diagnostic metadata, never an authorization capability. */
export interface AgentSessionDiagnosticContext {
  readonly connectionId?: string;
  readonly sessionId?: string;
  readonly acpSessionId?: string;
  readonly operationId?: string;
  readonly attemptId?: string;
  readonly agentRef?: string;
  readonly spaceRef?: string;
  readonly actorRef?: string;
}

type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticFields = Readonly<Record<string, unknown>>;

interface AgentSessionDiagnosticState {
  readonly contextStorage: AsyncLocalStorage<AgentSessionDiagnosticContext>;
  readonly workerId: string;
  successWindowAt: number;
  successRecords: number;
  suppressedSuccessCount: number;
}

const diagnosticGlobals = globalThis as typeof globalThis & {
  __busabaseAgentSessionDiagnosticState?: AgentSessionDiagnosticState;
};
if (!diagnosticGlobals.__busabaseAgentSessionDiagnosticState)
  diagnosticGlobals.__busabaseAgentSessionDiagnosticState = {
    contextStorage: new AsyncLocalStorage<AgentSessionDiagnosticContext>(),
    workerId: `acpw_${process.pid}_${randomUUID()}`,
    successWindowAt: 0,
    successRecords: 0,
    suppressedSuccessCount: 0,
  };
const diagnosticState = diagnosticGlobals.__busabaseAgentSessionDiagnosticState;
const { contextStorage, workerId } = diagnosticState;
const MAX_CAUSE_DEPTH = 8;
const MAX_SUCCESS_RECORDS_PER_SECOND = 20;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:/-]{1,160}$/;
const UNSAFE_SECRET = /(?:Bearer|(?:^|[^a-z])(?:sk|bso|secret|token)_[A-Za-z0-9])/i;
const driverCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
]);
const tables = new Set(["busabase_agent_sessions", "busabase_agent_session_events"]);
const constraints = new Set([
  "busabase_agent_sessions_pkey",
  "busabase_agent_session_events_pkey",
  "busabase_agent_session_events_session_seq_idx",
  "busabase_agent_session_events_session_id_busabase_agent_sessions_id_fk",
]);
const identifierFields = new Set([
  "connectionId",
  "sessionId",
  "acpSessionId",
  "operationId",
  "attemptId",
  "diagnosticRef",
  "agentRef",
  "spaceRef",
  "actorRef",
  "stage",
  "outcome",
  "reason",
  "transport",
  "ownerId",
  "operationKind",
  "capabilityProfile",
]);
const numericFields = new Set([
  "elapsedMs",
  "fencingToken",
  "seqFrom",
  "seqThrough",
  "persistedSeq",
  "queueDepth",
  "eventCount",
  "byteCount",
  "afterSeq",
  "upstreamSeq",
  "protocolVersion",
  "retryAttempt",
  "ttlSeconds",
  "rowCount",
]);

function safeRead(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) && !UNSAFE_SECRET.test(value)
    ? value
    : undefined;
}

/** Only explicitly named scalars cross the logging boundary. No exception strings do. */
function safeFields(fields: DiagnosticFields): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of identifierFields) {
    const value = safeIdentifier(safeRead(fields, key));
    if (value !== undefined) result[key] = value;
  }
  for (const key of numericFields) {
    const value = safeRead(fields, key);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      result[key] = Math.min(value, Number.MAX_SAFE_INTEGER);
  }
  const endpoint = safeRead(fields, "endpoint");
  if (typeof endpoint === "string") {
    try {
      const url = new URL(endpoint);
      if (["http:", "https:", "ws:", "wss:"].includes(url.protocol))
        result.endpoint = `${url.protocol}//${url.host}${url.pathname}`.slice(0, 256);
    } catch {
      // An invalid endpoint is not useful enough to retain arbitrary input.
    }
  }
  return result;
}

export function agentSessionScopeReferences(scope: {
  readonly spaceId: string;
  readonly actorId: string | null;
}): Pick<AgentSessionDiagnosticContext, "spaceRef" | "actorRef"> {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
  return {
    spaceRef: hash(scope.spaceId),
    ...(scope.actorId === null ? {} : { actorRef: hash(scope.actorId) }),
  };
}

export function captureAgentSessionDiagnosticContext(
  fields: AgentSessionDiagnosticContext = {},
): AgentSessionDiagnosticContext {
  return Object.freeze(safeFields({ ...contextStorage.getStore(), ...fields }));
}

export function withAgentSessionDiagnosticContext<T>(
  context: AgentSessionDiagnosticContext,
  operation: () => T,
): T {
  return contextStorage.run(captureAgentSessionDiagnosticContext(context), operation);
}

/** Extract known machine codes, not raw error.message/query/params/detail/stack. */
export function describeAgentSessionStorageError(error: unknown): {
  failureClass: "storage_failure" | "connection_failure" | "unclassified_failure";
  sqlState?: string;
  driverCode?: string;
  table?: string;
  constraint?: string;
} {
  const result: ReturnType<typeof describeAgentSessionStorageError> = {
    failureClass: "unclassified_failure",
  };
  let candidate = error;
  const seen = new Set<object>();
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) break;
    seen.add(candidate);
    const code = safeRead(candidate, "code");
    if (typeof code === "string") {
      if (driverCodes.has(code)) {
        result.driverCode ??= code;
        if (!result.sqlState) result.failureClass = "connection_failure";
      } else if (/^[0-9A-Z]{5}$/.test(code)) {
        result.sqlState ??= code;
        result.failureClass = "storage_failure";
      }
    }
    const table = safeRead(candidate, "table") ?? safeRead(candidate, "table_name");
    if (typeof table === "string" && tables.has(table)) result.table ??= table;
    const constraint = safeRead(candidate, "constraint") ?? safeRead(candidate, "constraint_name");
    if (typeof constraint === "string" && constraints.has(constraint))
      result.constraint ??= constraint;
    candidate = safeRead(candidate, "cause");
  }
  return result;
}

/**
 * Fixed-size process-wide limiting, without a map keyed by user/session IDs.
 * Failures and explicit lifecycle summaries are never sampled. Diagnostics
 * cannot change the operation's outcome even when a console sink throws.
 */
export function logAgentSessionDiagnostic(
  event: string,
  fields: DiagnosticFields = {},
  options: { level?: DiagnosticLevel; error?: unknown; force?: boolean } = {},
): void {
  try {
    const level = options.level ?? "info";
    const force = options.force === true || level !== "info" || options.error !== undefined;
    const now = Date.now();
    if (now < diagnosticState.successWindowAt || now - diagnosticState.successWindowAt >= 1_000) {
      diagnosticState.successWindowAt = now;
      diagnosticState.successRecords = 0;
    }
    if (!force && diagnosticState.successRecords >= MAX_SUCCESS_RECORDS_PER_SECOND) {
      diagnosticState.suppressedSuccessCount += 1;
      return;
    }
    if (!force) diagnosticState.successRecords += 1;
    const safeEvent = safeIdentifier(event) ?? "diagnostic_event";
    const deploymentRef = safeIdentifier(
      process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_DEPLOYMENT_ID,
    );
    const record = {
      schemaVersion: 1,
      event: safeEvent,
      workerId,
      ...(deploymentRef ? { deploymentRef } : {}),
      ...safeFields({ ...contextStorage.getStore(), ...fields }),
      ...(options.error === undefined ? {} : describeAgentSessionStorageError(options.error)),
      ...(diagnosticState.suppressedSuccessCount
        ? { suppressedSuccessCount: diagnosticState.suppressedSuccessCount }
        : {}),
    };
    diagnosticState.suppressedSuccessCount = 0;
    console[level]("[agents:session]", record);
  } catch {
    // Logging is observational, including when its sink or hostile input fails.
  }
}
