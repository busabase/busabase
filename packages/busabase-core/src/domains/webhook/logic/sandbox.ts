import "server-only";

import { Worker } from "node:worker_threads";
// Not used on this thread: the worker requires it by name at runtime, which
// the app's file tracing cannot see. Importing it here is what puts the
// package (and its wasm) into the production build next to the server.
import "quickjs-emscripten";
import { SANDBOX_WORKER_SOURCE } from "./sandbox-worker-source";
import { checkUrlIsSafeToFetch, fetchWithSsrfGuard } from "./ssrf-guard";

const LOG_CAP_CHARS = 4000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
// Cap how many calls a single execution may make so a runaway
// `while (true) fetch(...)` can't fan out unboundedly before the overall
// `timeoutMs` budget catches it — 10 is generous for any legitimate "notify a
// couple of endpoints" use case while still bounding worst-case fan-out.
const MAX_FETCH_CALLS_PER_EXECUTION = 10;
// Truncate a fetched response body so a chatty endpoint cannot bloat memory or
// the eventual delivery-log detail via a function's return value. Large
// enough for a typical API answer, an AI agent's reply included, to arrive
// whole and still parse as JSON.
const FETCH_BODY_CAP_CHARS = 32_000;
/**
 * Functions running at once in this process. Each one is a worker thread, so
 * this bounds the threads (and their memory) a burst of runs can start; the
 * rest wait their turn.
 */
const MAX_CONCURRENT_FUNCTIONS = 4;
/** After the deadline, how long a worker gets to report before it is terminated. */
const TERMINATE_GRACE_MS = 500;

export interface RunFunctionResult {
  /** JSON-serializable value the function returned, or `undefined` on error. */
  result: unknown;
  /** Captured `console.log` output, newline-joined, capped at ~4000 chars. */
  logs: string;
  /** Non-null when the function threw, timed out, or returned a non-serializable value. */
  error: string | null;
}

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// ── concurrency ─────────────────────────────────────────────────────────
let running = 0;
const waiting: (() => void)[] = [];
const acquireSlot = async (): Promise<void> => {
  if (running < MAX_CONCURRENT_FUNCTIONS) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
};
const releaseSlot = (): void => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

type FetchOptions = { method?: unknown; headers?: unknown; body?: unknown } | undefined;

/**
 * One `fetch` from inside a function, on the main thread: SSRF-guarded on the
 * first URL and on every redirect hop, bounded by the function's timeout, and
 * answered as the plain `{ status, ok, headers, body }` the worker turns into
 * a standard-looking response. Throws with the message the function sees.
 */
const guardedFetch = async (url: unknown, options: FetchOptions, timeoutMs: number) => {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("fetch requires a non-empty URL string as its first argument");
  }
  const safety = await checkUrlIsSafeToFetch(url);
  if (safety.blocked) {
    throw new Error(`fetch blocked: ${safety.reason ?? "target is not allowed"} (SSRF protection)`);
  }
  const method =
    typeof options?.method === "string" && options.method.length > 0 ? options.method : "GET";
  const headers =
    options?.headers && typeof options.headers === "object"
      ? (options.headers as Record<string, string>)
      : undefined;
  const body =
    options?.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : safeStringify(options.body);
  const fetched = await fetchWithSsrfGuard(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (fetched.blocked) {
    // A redirect hop pointed somewhere the first URL was not allowed to.
    throw new Error(`fetch blocked: redirect target ${fetched.reason} (SSRF protection)`);
  }
  const response = fetched.response;
  const bodyText = await response.text().catch(() => "");
  const headersOut: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headersOut[key] = value;
  });
  return {
    status: response.status,
    ok: response.ok,
    headers: headersOut,
    body:
      bodyText.length > FETCH_BODY_CAP_CHARS
        ? `${bodyText.slice(0, FETCH_BODY_CAP_CHARS)}\n...[truncated]`
        : bodyText,
  };
};

/**
 * Run a sandboxed JS function in an isolated QuickJS WASM VM, on its own
 * worker thread.
 *
 * The globals exposed to the function are `input` (the JSON-decoded event
 * payload), a `console.log` that appends to a bounded log buffer, and a
 * `fetch(url, options)` that answers like the standard one. No `require`,
 * `process`, `import`, or any other Node/browser API is reachable from inside
 * the VM, so filesystem and env access remain structurally impossible. The
 * function body runs as an `async` function so a bare top-level `return` and
 * `await fetch(...)` both work.
 *
 * The VM runs on a worker thread, not the server's main thread: a busy loop
 * would otherwise freeze every request this process serves until the
 * deadline. At the deadline the worker is terminated, which ends a busy loop
 * and a promise that never settles alike. Each `fetch` comes back to the main
 * thread and goes through the SSRF guard there.
 *
 * Never throws: VM exceptions, timeouts, a worker that dies, and
 * non-JSON-serializable results all come back in `error`, so a caller can
 * always persist a delivery record instead of crashing the dispatch.
 */
export async function runFunction(
  code: string,
  input: unknown,
  timeoutMs: number,
): Promise<RunFunctionResult> {
  await acquireSlot();
  try {
    return await runOnWorker(code, input, timeoutMs);
  } finally {
    releaseSlot();
  }
}

const runOnWorker = (code: string, input: unknown, timeoutMs: number): Promise<RunFunctionResult> =>
  new Promise((resolve) => {
    let settled = false;
    let fetchCalls = 0;
    let logs = "";
    let worker: Worker;
    try {
      worker = new Worker(SANDBOX_WORKER_SOURCE, {
        eval: true,
        workerData: {
          code,
          input: input ?? null,
          timeoutMs,
          memoryLimitBytes: MEMORY_LIMIT_BYTES,
          logCapChars: LOG_CAP_CHARS,
          bodyCapChars: FETCH_BODY_CAP_CHARS,
        },
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      });
    } catch (error) {
      resolve({
        result: undefined,
        logs: "",
        error: `Could not start the function: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }

    const end = (result: RunFunctionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      void worker.terminate().catch(() => {});
      resolve(result);
    };
    const deadline = setTimeout(
      () =>
        end({
          result: undefined,
          logs,
          error: `Function execution timed out after ${timeoutMs}ms`,
        }),
      timeoutMs + TERMINATE_GRACE_MS,
    );

    worker.on("message", (message: Record<string, unknown>) => {
      if (message.type === "done") {
        logs = typeof message.logs === "string" ? message.logs : logs;
        const error = typeof message.error === "string" ? message.error : null;
        end({
          result: error ? undefined : message.result,
          logs,
          // The VM's own interrupt fires first on a busy loop; say what happened.
          error:
            error === "interrupted" ? `Function execution timed out after ${timeoutMs}ms` : error,
        });
        return;
      }
      if (message.type !== "fetch") return;
      const id = message.id;
      fetchCalls += 1;
      if (fetchCalls > MAX_FETCH_CALLS_PER_EXECUTION) {
        worker.postMessage({
          type: "fetchResult",
          id,
          ok: false,
          error: `fetch call limit exceeded (max ${MAX_FETCH_CALLS_PER_EXECUTION} calls per function execution)`,
        });
        return;
      }
      guardedFetch(message.url, message.options as FetchOptions, timeoutMs).then(
        (value) => {
          if (!settled) worker.postMessage({ type: "fetchResult", id, ok: true, value });
        },
        (error: unknown) => {
          if (settled) return;
          // A call cut off by the function's own deadline says so, rather
          // than the HTTP client's "operation was aborted".
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          worker.postMessage({
            type: "fetchResult",
            id,
            ok: false,
            error: timedOut
              ? `fetch aborted: function execution timed out after ${timeoutMs}ms`
              : error instanceof Error
                ? error.message
                : String(error),
          });
        },
      );
    });
    worker.on("error", (error) =>
      end({
        result: undefined,
        logs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    worker.on("exit", (exitCode) =>
      end({
        result: undefined,
        logs,
        error: `The function stopped unexpectedly (exit code ${exitCode})`,
      }),
    );
  });
