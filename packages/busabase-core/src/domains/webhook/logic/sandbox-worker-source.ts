/**
 * The worker thread that runs one function, as source text: started with
 * `new Worker(SANDBOX_WORKER_SOURCE, { eval: true })` so no separate file has
 * to survive the app's bundler. Plain CommonJS; its only dependency is
 * `quickjs-emscripten`, loaded with `import()` like the main thread loads it.
 * Both apps keep it external (`serverExternalPackages`) so it resolves from
 * node_modules, and `sandbox.ts` imports it so the build copies it there.
 *
 * The worker never touches the network. `fetch` inside the VM posts a message
 * to the main thread, which runs the SSRF-guarded request and posts the answer
 * back, so the one copy of that guard is the one that runs. The main thread
 * terminates the worker on timeout, which ends a busy loop or a promise that
 * never settles, and frees everything the VM held.
 *
 * Messages: worker → main `{ type: "fetch", id, url, options }` and
 * `{ type: "done", result, logs, error }`; main → worker
 * `{ type: "fetchResult", id, ok, value | error }`.
 */
export const SANDBOX_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");

const { code, input, timeoutMs, memoryLimitBytes, logCapChars, bodyCapChars } = workerData;

let logs = "";
let logsTruncated = false;
const appendLog = (line) => {
  if (logsTruncated) return;
  if (logs.length + line.length > logCapChars) {
    logs += line.slice(0, Math.max(0, logCapChars - logs.length)) + "\n...[truncated]";
    logsTruncated = true;
    return;
  }
  logs += logs ? "\n" + line : line;
};
const safeStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
const describe = (dumped) =>
  dumped && typeof dumped === "object" && typeof dumped.message === "string"
    ? dumped.message
    : safeStringify(dumped);
let finished = false;
const finish = (message) => {
  if (finished) return;
  finished = true;
  parentPort.postMessage({ type: "done", logs, ...message });
};

(async () => {
  // import(), not require(): the production build carries the package's ESM
  // entry (the one the main thread's import uses), not its CommonJS one.
  const { getQuickJS, shouldInterruptAfterDeadline } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryLimitBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));
  const context = runtime.newContext();

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

  const inputHandle = context.newString(JSON.stringify(input === undefined ? null : input));
  context.setProp(context.global, "__busabaseWebhookInput", inputHandle);
  inputHandle.dispose();

  const toGuest = (value) => {
    const result = context.evalCode("(" + safeStringify(value) + ")");
    if (result.error) {
      result.error.dispose();
      throw new Error("failed to marshal a value into the sandbox");
    }
    return result.value;
  };

  // fetch: ask the main thread, settle the guest promise with its answer.
  const pending = new Map();
  let nextId = 0;
  parentPort.on("message", (message) => {
    if (!message || message.type !== "fetchResult") return;
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    if (message.ok) {
      const handle = toGuest(message.value);
      deferred.resolve(handle);
      handle.dispose();
    } else {
      const errorHandle = context.newError(message.error);
      deferred.reject(errorHandle);
      errorHandle.dispose();
    }
    runtime.executePendingJobs();
  });
  const fetchHandle = context.newFunction("fetch", (urlHandle, optionsHandle) => {
    const deferred = context.newPromise();
    const id = ++nextId;
    pending.set(id, deferred);
    let url;
    let options;
    try {
      url = context.dump(urlHandle);
      options = optionsHandle ? context.dump(optionsHandle) : undefined;
    } catch (error) {
      pending.delete(id);
      const errorHandle = context.newError(error && error.message ? error.message : String(error));
      deferred.reject(errorHandle);
      errorHandle.dispose();
      return deferred.handle;
    }
    parentPort.postMessage({ type: "fetch", id, url, options });
    return deferred.handle;
  });
  context.setProp(context.global, "fetch", fetchHandle);
  fetchHandle.dispose();

  // Code is written against the standard fetch: give the bridge's plain
  // { status, ok, headers, body } json(), text(), and headers.get(), and keep
  // the plain fields for functions written against them. The body of the
  // function runs as an async function, so a bare top-level return and
  // await both work.
  const wrapped =
    '(async function () {\n' +
    '"use strict";\n' +
    'var __bridgeFetch = globalThis.fetch;\n' +
    'globalThis.fetch = async function (url, options) {\n' +
    '  var raw = await __bridgeFetch(url, options);\n' +
    '  var text = typeof raw.body === "string" ? raw.body : "";\n' +
    '  var headers = Object.assign({}, raw.headers || {});\n' +
    '  Object.defineProperty(headers, "get", { enumerable: false, value: function (name) {\n' +
    '    var value = headers[String(name).toLowerCase()];\n' +
    '    return value === undefined ? null : value;\n' +
    '  } });\n' +
    '  return {\n' +
    '    status: raw.status, ok: raw.ok, headers: headers, body: text,\n' +
    '    text: async function () { return text; },\n' +
    '    json: async function () {\n' +
    '      if (text.endsWith("...[truncated]")) {\n' +
    '        throw new Error("The response was longer than ' + bodyCapChars + ' characters and was cut, so it is not valid JSON");\n' +
    '      }\n' +
    '      return JSON.parse(text);\n' +
    '    },\n' +
    '  };\n' +
    '};\n' +
    'var input = JSON.parse(__busabaseWebhookInput);\n' +
    'return (async function (input) {\n' +
    code +
    '\n})(input);\n' +
    '})()';

  const evalResult = context.evalCode(wrapped);
  if (evalResult.error) {
    const dumped = context.dump(evalResult.error);
    evalResult.error.dispose();
    finish({ result: undefined, error: describe(dumped) });
    return;
  }
  const settledPromise = context.resolvePromise(evalResult.value);
  runtime.executePendingJobs();
  const settled = await settledPromise;
  if (settled.error) {
    const dumped = context.dump(settled.error);
    settled.error.dispose();
    finish({ result: undefined, error: describe(dumped) });
    return;
  }
  const value = context.dump(settled.value);
  settled.value.dispose();
  try {
    JSON.stringify(value);
  } catch {
    finish({ result: undefined, error: "Function result is not JSON-serializable" });
    return;
  }
  // Nothing is disposed further: the main thread terminates this worker,
  // which frees the VM in one go.
  finish({ result: value, error: null });
})().catch((error) => {
  finish({ result: undefined, error: error && error.message ? error.message : String(error) });
});
`;
