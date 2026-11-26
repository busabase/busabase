import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type Context, ORPCError } from "@orpc/server";
import type { FetchHandlerOptions, FetchHandlerPlugin } from "@orpc/server/fetch";
import type { StandardHandlerOptions } from "@orpc/server/standard";

const DATABASE_REASONS: Record<string, string> = {
  "08001": "database_connection_failed",
  "08006": "database_connection_lost",
  "22001": "value_too_long",
  "22P02": "invalid_text_representation",
  "23502": "not_null_violation",
  "23503": "foreign_key_violation",
  "23505": "unique_violation",
  "40001": "serialization_failure",
  "40P01": "deadlock_detected",
  "42501": "insufficient_database_privilege",
  "42703": "undefined_column",
  "42P01": "undefined_table",
  "53300": "too_many_connections",
  "55P03": "lock_not_available",
  "57014": "query_canceled",
};
const ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "AggregateError",
  "ORPCError",
  "DrizzleError",
  "DrizzleQueryError",
  "PostgresError",
  "DatabaseError",
  "ValidationError",
]);
const MAX_CAUSES = 8;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

/** Error messages, including Drizzle's SQL/params and PostgreSQL's detail, are private. */
const field = (error: unknown, key: string): unknown => {
  if (!error || typeof error !== "object") return undefined;
  try {
    return Reflect.get(error, key);
  } catch {
    return undefined;
  }
};

const safeIdentifier = (value: unknown) =>
  typeof value === "string" && IDENTIFIER.test(value) ? value : undefined;

const errorFrames = (stack: unknown): string[] => {
  if (typeof stack !== "string") return [];
  // Keep code locations only. The first line and multiline SQL/error messages
  // must never be copied to logs; neither may eval strings or URL credentials.
  return stack
    .slice(0, 16_000)
    .split("\n", 80)
    .filter((line) => /^\s+at /.test(line))
    .flatMap((line) => {
      const location = line.match(
        /(?:\(|\s)(?:file:\/\/)?((?:\/|\.next\/)(?:[A-Za-z0-9_.@[\]()~+-]+\/)*[A-Za-z0-9_.@[\]()~+-]+\.(?:[cm]?[jt]s|tsx|jsx)):(\d+):(\d+)\)?$/,
      );
      return location ? [`${location[1]}:${location[2]}:${location[3]}`] : [];
    })
    .slice(0, 8);
};

const errorSummary = (error: unknown) => {
  const name = field(error, "name");
  const code = field(error, "code");
  const sqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  const identifiers: Record<string, string> = {};
  for (const key of ["schema", "table", "column", "constraint"]) {
    const value = safeIdentifier(field(error, key));
    if (value) identifiers[key] = value;
  }
  // Missing-relation errors often omit `table`. Only accept PostgreSQL's
  // exact message template and a plain identifier, never a general message.
  if (sqlState === "42P01" || sqlState === "42703") {
    const message = field(error, "message");
    const match =
      typeof message === "string"
        ? message.match(/^(?:relation|column) "([A-Za-z_][A-Za-z0-9_.]{0,127})" does not exist$/)
        : null;
    if (match?.[1]) identifiers[sqlState === "42P01" ? "table" : "column"] = match[1];
  }
  return {
    name: typeof name === "string" && ERROR_NAMES.has(name) ? name : "Error",
    ...(sqlState ? { sqlState, reason: DATABASE_REASONS[sqlState] ?? "database_error" } : {}),
    ...identifiers,
    frames: errorFrames(field(error, "stack")),
  };
};

interface RequestLogContext {
  requestId: string;
  method: string;
  pathname: string;
  loggedErrors: Set<unknown>;
  failure?: { error: unknown };
}

/**
 * Observe failures before oRPC turns them into responses. The Fetch adapter
 * owns one server-generated ID, including all logical calls inside a batch.
 * Only a strict projection is logged: no input, query, headers, raw errors,
 * messages, SQL, parameters, PostgreSQL detail/hint, or application data.
 */
export class BusabaseErrorLoggingPlugin<T extends Context> implements FetchHandlerPlugin<T> {
  // Install outside coercion/validation and batching plugins.
  readonly order = 10_000_000;
  private readonly requestContext = new AsyncLocalStorage<RequestLogContext>();

  private log(error: unknown, procedure?: readonly string[]) {
    if (error instanceof ORPCError && error.status < 500) return;
    const request = this.requestContext.getStore();
    if (!request || request.loggedErrors.has(error)) return;
    const causes: ReturnType<typeof errorSummary>[] = [];
    const visited = new Set<unknown>();
    let cause = error;
    while (
      cause !== undefined &&
      cause !== null &&
      !visited.has(cause) &&
      causes.length < MAX_CAUSES
    ) {
      visited.add(cause);
      request.loggedErrors.add(cause);
      causes.push(errorSummary(cause));
      cause = field(cause, "cause");
    }
    try {
      console.error(
        JSON.stringify({
          event: "busabase.api_error",
          level: "ERROR",
          requestId: request.requestId,
          method: request.method,
          pathname: request.pathname,
          ...(procedure ? { procedure: procedure.join(".") } : {}),
          status: error instanceof ORPCError ? error.status : 500,
          causes,
          ...(cause !== undefined && cause !== null ? { causesTruncated: true } : {}),
        }),
      );
    } catch {
      // Diagnostics must never replace the original error or response.
    }
  }

  init(options: StandardHandlerOptions<T>) {
    options.rootInterceptors ??= [];
    // After BatchHandlerPlugin: this scope describes one logical call and can
    // inspect its encoded status even when the batch envelope itself is 200.
    options.rootInterceptors.push(async ({ request, next }) => {
      const outer = this.requestContext.getStore();
      if (!outer) return next();
      return this.requestContext.run(
        {
          ...outer,
          method: request.method,
          pathname: request.url.pathname.slice(0, 1_024),
          loggedErrors: new Set(),
        },
        async () => {
          const result = await next();
          const failure = this.requestContext.getStore()?.failure;
          if (result.matched && result.response.status >= 500 && failure) this.log(failure.error);
          return result;
        },
      );
    });
    options.interceptors ??= [];
    options.interceptors.unshift(async ({ next }) => {
      try {
        return await next();
      } catch (error) {
        const request = this.requestContext.getStore();
        if (request) request.failure = { error };
        throw error;
      }
    });
    options.clientInterceptors ??= [];
    options.clientInterceptors.unshift(async ({ path, next }) => {
      try {
        return await next();
      } catch (error) {
        this.log(error, path);
        throw error;
      }
    });
  }

  initRuntimeAdapter(options: FetchHandlerOptions<T>) {
    options.adapterInterceptors ??= [];
    options.adapterInterceptors.unshift(async ({ request, next }) => {
      const requestId = randomUUID();
      return this.requestContext.run(
        {
          requestId,
          method: request.method,
          pathname: new URL(request.url).pathname.slice(0, 1_024),
          loggedErrors: new Set(),
        },
        async () => {
          try {
            const result = await next();
            if (result.matched) result.response.headers.set("x-request-id", requestId);
            return result;
          } catch (error) {
            this.log(error);
            throw error;
          }
        },
      );
    });
  }
}
