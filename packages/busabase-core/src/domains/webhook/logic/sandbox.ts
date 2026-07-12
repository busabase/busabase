import "server-only";

import type { QuickJSDeferredPromise, QuickJSHandle } from "quickjs-emscripten";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { checkUrlIsSafeToFetch } from "./ssrf-guard";

const LOG_CAP_CHARS = 4000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
// The fetch bridge (see "fetch bridge" below) lets a function's code make
// outbound HTTP calls directly instead of returning a call-spec for the host
// to perform (the mechanism this replaces — see dispatch.ts). Cap how many
// calls a single execution may make so a runaway `while (true) fetch(...)`
// can't fan out unboundedly before the overall `timeoutMs` budget catches
// it — 10 is generous for any legitimate "notify a couple of endpoints"
// use case while still bounding worst-case fan-out from one execution.
const MAX_FETCH_CALLS_PER_EXECUTION = 10;
// Truncate a fetched response body the same way console.log output is
// capped (LOG_CAP_CHARS) — keeps a chatty endpoint from bloating memory or
// the eventual delivery-log detail via a function's return value.
const FETCH_BODY_CAP_CHARS = LOG_CAP_CHARS;

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

const describeVmError = (dumped: unknown): string => {
  if (dumped && typeof dumped === "object" && "message" in dumped) {
    const message = (dumped as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return safeStringify(dumped);
};

/**
 * Run a sandboxed JS function in an isolated QuickJS WASM VM.
 *
 * The globals exposed to the function are `input` (the JSON-decoded event
 * payload), a `console.log` that appends to a bounded log buffer, and a
 * `fetch(url, options)` bridge (see the "fetch bridge" section below) — no
 * `require`, `process`, `import`, or any other Node/browser API is reachable
 * from inside the VM, so filesystem and env access remain structurally
 * impossible from inside a function. The function body runs as an `async`
 * function so a bare top-level `return` (and `await fetch(...)`) both work
 * naturally.
 *
 * Never throws: VM exceptions, interrupt-handler timeouts, a wall-clock
 * timeout while genuinely awaiting network I/O, and non-JSON-serializable
 * results are all captured into `error` so a caller can always persist a
 * delivery record instead of crashing the dispatch.
 */
export async function runFunction(
  code: string,
  input: unknown,
  timeoutMs: number,
): Promise<RunFunctionResult> {
  let logs = "";
  let logsTruncated = false;
  const appendLog = (line: string) => {
    if (logsTruncated) return;
    if (logs.length + line.length > LOG_CAP_CHARS) {
      logs += `${line.slice(0, Math.max(0, LOG_CAP_CHARS - logs.length))}\n...[truncated]`;
      logsTruncated = true;
      return;
    }
    logs += logs ? `\n${line}` : line;
  };

  try {
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
    const context = runtime.newContext();

    // Guards the fetch bridge's async continuations (below) against
    // touching context/runtime handles after a wall-clock timeout has
    // already disposed them out from under an in-flight real `fetch()` that
    // this VM has no way to cancel from here.
    let disposed = false;
    const disposeVm = () => {
      if (disposed) return;
      disposed = true;
      try {
        context.dispose();
      } catch {
        // already gone
      }
      try {
        runtime.dispose();
      } catch {
        // already gone
      }
    };

    try {
      const consoleHandle = context.newObject();
      const logFn = context.newFunction("log", (...args) => {
        appendLog(
          args
            .map((arg) => {
              const value = context.dump(arg);
              return typeof value === "string" ? value : safeStringify(value);
            })
            .join(" "),
        );
      });
      context.setProp(consoleHandle, "log", logFn);
      context.setProp(context.global, "console", consoleHandle);
      logFn.dispose();
      consoleHandle.dispose();

      const inputHandle = context.newString(JSON.stringify(input ?? null));
      context.setProp(context.global, "__busabaseWebhookInput", inputHandle);
      inputHandle.dispose();

      // Converts an arbitrary JSON-serializable host value into a guest
      // handle by evaluating it as a JS literal — the same JSON round-trip
      // technique `input` above uses inline, reused here because the fetch
      // bridge needs to inject a value (the response) well after the
      // initial evalCode call, from inside an async host callback.
      const toGuestValue = (value: unknown): QuickJSHandle => {
        const evalResult = context.evalCode(`(${safeStringify(value)})`);
        if (evalResult.error) {
          evalResult.error.dispose();
          throw new Error("failed to marshal a value into the sandbox");
        }
        return evalResult.value;
      };

      // ── fetch bridge ──────────────────────────────────────────────────
      //
      // The ONLY way a function reaches the network. Every call is
      // SSRF-guarded (checkUrlIsSafeToFetch, same guard `dispatch.ts` uses
      // for the `webhook`/`notify_agent` direct POST), capped in count
      // (MAX_FETCH_CALLS_PER_EXECUTION), and bounded to the function's own
      // configured `timeoutMs` per call. Implements the async-bridge pattern
      // from quickjs-emscripten's own docs: return a `context.newPromise()`
      // handle synchronously, do the real work on the host, then
      // `deferred.resolve/reject` and nudge `runtime.executePendingJobs()`
      // once the deferred settles so the guest's `await fetch(...)` actually
      // resumes (quickjs-emscripten never drains the job queue on its own).
      // Every in-flight fetch's deferred, tracked so a wall-clock timeout
      // (below) can force-settle each one before tearing down the VM.
      // QuickJS's runtime teardown asserts every GC-tracked object was
      // explicitly freed first (`list_empty(&rt->gc_obj_list)` inside
      // `JS_FreeRuntime`) — abandoning an in-flight deferred and disposing
      // the runtime out from under it is a hard crash, not a harmless leak.
      const pendingDeferreds = new Set<QuickJSDeferredPromise>();

      let fetchCallCount = 0;
      const fetchHandle = context.newFunction("fetch", (urlHandle, optionsHandle) => {
        const deferred = context.newPromise();
        pendingDeferreds.add(deferred);
        deferred.settled
          .then(() => {
            pendingDeferreds.delete(deferred);
            if (!disposed) runtime.executePendingJobs();
          })
          .catch(() => {
            // Never let a queue-drain failure surface as an unhandled rejection.
          });

        const rejectWith = (message: string) => {
          if (disposed) return;
          const errorHandle = context.newError(message);
          deferred.reject(errorHandle);
          errorHandle.dispose();
        };

        fetchCallCount += 1;
        if (fetchCallCount > MAX_FETCH_CALLS_PER_EXECUTION) {
          rejectWith(
            `fetch call limit exceeded (max ${MAX_FETCH_CALLS_PER_EXECUTION} calls per function execution)`,
          );
          return deferred.handle;
        }

        let url: unknown;
        let options: { method?: unknown; headers?: unknown; body?: unknown } | undefined;
        try {
          url = context.dump(urlHandle);
          options = optionsHandle ? context.dump(optionsHandle) : undefined;
        } catch (error) {
          rejectWith(error instanceof Error ? error.message : String(error));
          return deferred.handle;
        }

        if (typeof url !== "string" || url.length === 0) {
          rejectWith("fetch requires a non-empty URL string as its first argument");
          return deferred.handle;
        }

        void (async () => {
          try {
            const safety = await checkUrlIsSafeToFetch(url as string);
            if (disposed) return;
            if (safety.blocked) {
              rejectWith(
                `fetch blocked: ${safety.reason ?? "target is not allowed"} (SSRF protection)`,
              );
              return;
            }

            const method =
              typeof options?.method === "string" && options.method.length > 0
                ? options.method
                : "GET";
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

            const response = await fetch(url as string, {
              method,
              headers,
              body,
              // A single call can't outlive the function's own configured
              // timeout budget — the same `timeoutMs` the overall execution
              // is bound by (see the wall-clock race below).
              signal: AbortSignal.timeout(timeoutMs),
            });
            const bodyText = await response.text().catch(() => "");
            if (disposed) return;

            const headersOut: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              headersOut[key] = value;
            });

            const resultHandle = toGuestValue({
              status: response.status,
              ok: response.ok,
              headers: headersOut,
              body:
                bodyText.length > FETCH_BODY_CAP_CHARS
                  ? `${bodyText.slice(0, FETCH_BODY_CAP_CHARS)}\n...[truncated]`
                  : bodyText,
            });
            deferred.resolve(resultHandle);
            resultHandle.dispose();
          } catch (error) {
            rejectWith(error instanceof Error ? error.message : String(error));
          }
        })();

        return deferred.handle;
      });
      context.setProp(context.global, "fetch", fetchHandle);
      fetchHandle.dispose();

      // Wrapped as an IIFE-of-an-async-function-body so a bare top-level
      // `return` in the user's function works naturally (instead of raising
      // a syntax error as it would as a raw top-level script), and so
      // `await fetch(...)` is valid syntax inside it.
      const wrapped = `(async function () {
        "use strict";
        var input = JSON.parse(__busabaseWebhookInput);
        return (async function (input) {
          ${code}
        })(input);
      })()`;

      const evalResult = context.evalCode(wrapped);
      if (evalResult.error) {
        const dumped = context.dump(evalResult.error);
        evalResult.error.dispose();
        return { result: undefined, logs, error: describeVmError(dumped) };
      }

      const promiseHandle = evalResult.value;
      // `resolvePromise` synchronously registers a `.then()` reaction on the
      // guest promise (via quickjs-emscripten's internal
      // `Promise.resolve(handle).then(resolveHandle, rejectHandle)`) before
      // it returns — call it BEFORE draining the job queue, not after, or a
      // function that completes synchronously (no `fetch` calls at all) has
      // no listener registered yet when we flush, and its settlement is
      // never observed (hangs until the wall-clock timeout below instead of
      // returning immediately).
      const settledPromise = context.resolvePromise(promiseHandle);
      // Flush any jobs already queued — fires the reaction just registered
      // above if the function's promise had already settled synchronously.
      // If the function is still pending on a real `await fetch(...)`,
      // this is a no-op; the fetch bridge's own per-call
      // `deferred.settled.then(() => runtime.executePendingJobs())` (above)
      // picks up progression once that real fetch eventually settles.
      runtime.executePendingJobs();

      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timeoutTimer = setTimeout(() => resolve("timeout"), timeoutMs);
      });

      // The `shouldInterruptAfterDeadline` interrupt handler set above only
      // fires while the VM is actually executing synchronous bytecode — not
      // while it's suspended waiting on a real, host-side `await fetch(...)`
      // outside the VM entirely. This wall-clock race is what actually
      // bounds THAT case.
      const race = await Promise.race([
        settledPromise.then((settled) => ({ kind: "settled" as const, settled })),
        timedOut.then(() => ({ kind: "timeout" as const })),
      ]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      if (race.kind === "timeout") {
        // A real host `fetch()` this VM can't cancel may still be in
        // flight — force-reject every fetch call still outstanding so the
        // guest's suspended `await fetch(...)` actually unwinds instead of
        // leaving live, un-freed Promise machinery behind (see
        // `pendingDeferreds`'s comment above). Bounded to a handful of
        // rounds: each round can itself synchronously spawn a few new fetch
        // calls (a caught rejection followed by another `await fetch(...)`),
        // but `MAX_FETCH_CALLS_PER_EXECUTION` bounds how many real ones
        // exist at any point, and this only needs to converge, not run long.
        for (let round = 0; round < 20 && pendingDeferreds.size > 0; round++) {
          for (const deferred of pendingDeferreds) {
            const timeoutErrorHandle = context.newError(
              `fetch aborted: function execution timed out after ${timeoutMs}ms`,
            );
            deferred.reject(timeoutErrorHandle);
            timeoutErrorHandle.dispose();
          }
          pendingDeferreds.clear();
          runtime.executePendingJobs();
        }

        // `settledPromise` (from `context.resolvePromise` above) is a plain
        // native promise — abandoning it here (never `.then()`/`await`ing
        // it again after losing the race) would leak whatever QuickJSHandle
        // it eventually resolves or rejects with: nothing would ever call
        // `.dispose()` on it, leaving one more object in the runtime's
        // GC-tracked list and tripping the same `list_empty(&rt->
        // gc_obj_list)` assertion in `JS_FreeRuntime` as an undisposed
        // `pendingDeferreds` entry would. The reject+drain above already
        // forced the underlying QuickJS-side chain to settle, so this
        // resolves immediately — it's bookkeeping, not a real wait.
        const abandonedSettled = await settledPromise;
        if (abandonedSettled.error) {
          abandonedSettled.error.dispose();
        } else {
          abandonedSettled.value.dispose();
        }

        promiseHandle.dispose();
        return {
          result: undefined,
          logs,
          error: `Function execution timed out after ${timeoutMs}ms`,
        };
      }

      promiseHandle.dispose();
      const settled = race.settled;
      if (settled.error) {
        const dumped = context.dump(settled.error);
        settled.error.dispose();
        return { result: undefined, logs, error: describeVmError(dumped) };
      }

      const resultHandle = settled.value;
      const value = context.dump(resultHandle);
      resultHandle.dispose();

      try {
        JSON.stringify(value);
      } catch {
        return { result: undefined, logs, error: "Function result is not JSON-serializable" };
      }

      return { result: value, logs, error: null };
    } finally {
      disposeVm();
    }
  } catch (error) {
    return {
      result: undefined,
      logs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
