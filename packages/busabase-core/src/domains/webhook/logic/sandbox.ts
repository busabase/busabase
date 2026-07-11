import "server-only";

import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

const LOG_CAP_CHARS = 4000;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;

export interface RunSnippetResult {
  /** JSON-serializable value the snippet returned, or `undefined` on error. */
  result: unknown;
  /** Captured `console.log` output, newline-joined, capped at ~4000 chars. */
  logs: string;
  /** Non-null when the snippet threw, timed out, or returned a non-serializable value. */
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
 * Run a sandboxed JS snippet in an isolated QuickJS WASM VM.
 *
 * The ONLY globals exposed to the snippet are `input` (the JSON-decoded event
 * payload) and a `console.log` that appends to a bounded log buffer — there is
 * no `fetch`, `require`, `process`, `import`, or any other Node/browser API in
 * the VM, so network, filesystem, and env access are structurally impossible
 * from inside a snippet. The snippet body runs as a function so a bare
 * top-level `return` works.
 *
 * Never throws: VM exceptions, interrupt-handler timeouts, and
 * non-JSON-serializable results are all captured into `error` so a caller can
 * always persist a delivery record instead of crashing the dispatch.
 */
export async function runSnippet(
  code: string,
  input: unknown,
  timeoutMs: number,
): Promise<RunSnippetResult> {
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
    try {
      runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
      runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

      const context = runtime.newContext();
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

        // Wrapped as an IIFE-of-a-function-body so a bare top-level `return`
        // in the user's snippet works naturally, instead of raising a syntax
        // error as it would as a raw top-level script.
        const wrapped = `(function () {
          "use strict";
          var input = JSON.parse(__busabaseWebhookInput);
          return (function (input) {
            ${code}
          })(input);
        })()`;

        const evalResult = context.evalCode(wrapped);
        if (evalResult.error) {
          const dumped = context.dump(evalResult.error);
          evalResult.error.dispose();
          return { result: undefined, logs, error: describeVmError(dumped) };
        }

        const value = context.dump(evalResult.value);
        evalResult.value.dispose();

        try {
          JSON.stringify(value);
        } catch {
          return { result: undefined, logs, error: "Snippet result is not JSON-serializable" };
        }

        return { result: value, logs, error: null };
      } finally {
        context.dispose();
      }
    } finally {
      runtime.dispose();
    }
  } catch (error) {
    return {
      result: undefined,
      logs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
