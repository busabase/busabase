import "server-only";

import { resolveContextAirAppEngineLock } from "../../../context";
import { resolveSandockConfig, sandockClient } from "../../airapp/logic/sandock-runtime";
import type { WorkflowSandboxCall, WorkflowSandboxPoll } from "./runs";

/**
 * A Function step's code on a sandbox machine, for work the in-app sandbox
 * cannot do: npm or pip packages, Node's `crypto`, Python, minutes of time.
 *
 * It uses the same Sandock and the same plan gate as an AirApp's `remote`
 * engine: configured by `SANDOCK_API_KEY`, and on Busabase Cloud a space whose
 * plan leaves `remote` out is refused here, before any machine is provisioned.
 *
 * The code runs detached. `start` provisions a machine, writes the code, its
 * input, and a small runner, starts the runner in the background, and returns.
 * The run then waits like a Wait, and the scheduler calls `poll` until the
 * runner has written `done`. Nothing holds a request or a scheduler tick open
 * while packages install or the code runs.
 *
 * Code is a function body in both languages, like a step's in-app code:
 * `input` holds the run's data and what it returns is the step's output. In
 * JavaScript `require` and `await import()` load installed packages; in
 * Python the body is compiled as a function, so `return` works and installed
 * packages import normally.
 */

const STEP_DIR = "/workspace/step";
/** Installing packages gets its own bound, inside the step's overall one. */
const INSTALL_TIMEOUT_SECONDS = 300;
/** The provider reaps the machine on its own clock too, so a lost run cannot keep one alive. */
const SANDBOX_DEADLINE_SECONDS = 30 * 60;
const SANDBOX_CPU_MILLICORES = 1000;
const SANDBOX_MEMORY_LIMIT_MB = 1024;
const LOG_CAP_CHARS = 4000;
const MAX_PACKAGES = 30;
/** Package specs as npm and pip write them: names, scopes, versions and ranges. */
const PACKAGE_SPEC = /^[A-Za-z0-9@][A-Za-z0-9@._/=<>~^!*+-]{0,199}$/;

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

/** The packages a step asked for, or an error naming the first one that is not a package spec. */
export const parseSandboxPackages = (text: string): string[] => {
  const specs = text
    .split(/[\s,]+/)
    .map((spec) => spec.trim())
    .filter(Boolean);
  if (specs.length > MAX_PACKAGES) {
    throw new Error(`A sandbox step installs at most ${MAX_PACKAGES} packages`);
  }
  const bad = specs.find((spec) => !PACKAGE_SPEC.test(spec));
  if (bad) throw new Error(`"${bad}" is not a package name`);
  return specs;
};

const JAVASCRIPT_RUNNER = String.raw`import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const here = (name) => new URL("./" + name, import.meta.url);
const require = createRequire(here("package.json"));
const logs = [];
const show = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
const capture = (...args) => logs.push(args.map(show).join(" "));
console.log = capture;
console.info = capture;
console.warn = capture;
console.error = capture;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
let out;
try {
  const input = JSON.parse(readFileSync(here("input.json"), "utf8"));
  const code = readFileSync(here("code.js"), "utf8");
  const value = await new AsyncFunction("input", "require", code)(input, require);
  out = { ok: true, result: value === undefined ? null : value };
} catch (error) {
  out = { ok: false, error: error instanceof Error ? error.message : String(error) };
}
out.logs = logs.join("\n").slice(0, ${LOG_CAP_CHARS});
let text;
try {
  text = JSON.stringify(out);
} catch {
  text = JSON.stringify({ ok: false, error: "The returned value is not JSON-serializable", logs: out.logs });
}
writeFileSync(here("result.json"), text);
`;

const PYTHON_RUNNER = String.raw`import ast, contextlib, io, json, sys

STEP = "${STEP_DIR}"
sys.path.insert(0, STEP + "/pydeps")
logs = io.StringIO()
out = {}
try:
    with open(STEP + "/input.json") as handle:
        step_input = json.load(handle)
    with open(STEP + "/code.py") as handle:
        source = handle.read()
    # Compile the code as the body of a function, so a top-level return works
    # without re-indenting it (which would change multi-line strings).
    body = ast.parse(source, "step.py").body
    function = ast.parse("def __busabase_step(input):\n    pass").body[0]
    function.body = body or [ast.Pass()]
    module = ast.Module(body=[function], type_ignores=[])
    ast.fix_missing_locations(module)
    scope = {}
    with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
        exec(compile(module, "step.py", "exec"), scope)
        value = scope["__busabase_step"](step_input)
    out = {"ok": True, "result": value}
except Exception as error:
    out = {"ok": False, "error": type(error).__name__ + ": " + str(error)}
out["logs"] = logs.getvalue()[:${LOG_CAP_CHARS}]
try:
    text = json.dumps(out)
except Exception:
    text = json.dumps({"ok": False, "error": "The returned value is not JSON-serializable", "logs": out["logs"]})
with open(STEP + "/result.json", "w") as handle:
    handle.write(text)
`;

/**
 * The script the machine runs in the background: install, run, then write
 * `done` with the phase and exit status. Whatever the code returned is already
 * in `result.json` by then; a phase that failed before writing it leaves its
 * output in `install.log` or `run.log` for `poll` to report.
 */
const runScript = (call: WorkflowSandboxCall, packages: string[]): string => {
  const runSeconds = Math.max(1, Math.ceil(call.timeoutMs / 1000));
  const quoted = packages.map(shellQuote).join(" ");
  const install =
    packages.length === 0
      ? "true"
      : call.language === "python"
        ? `timeout ${INSTALL_TIMEOUT_SECONDS} pip install --quiet --disable-pip-version-check --target ${STEP_DIR}/pydeps ${quoted}`
        : `timeout ${INSTALL_TIMEOUT_SECONDS} npm install --no-audit --no-fund --loglevel=error ${quoted}`;
  const run =
    call.language === "python"
      ? `timeout ${runSeconds} python3 ${STEP_DIR}/main.py`
      : `timeout ${runSeconds} node ${STEP_DIR}/main.mjs`;
  return [
    `cd ${STEP_DIR}`,
    `${install} > install.log 2>&1`,
    `status=$?`,
    `if [ "$status" -ne 0 ]; then echo "install $status" > done.tmp; mv done.tmp done; exit 0; fi`,
    `${run} > run.log 2>&1`,
    `status=$?`,
    `echo "run $status" > done.tmp`,
    `mv done.tmp done`,
    "",
  ].join("\n");
};

/** Refuse before provisioning: no Sandock here, or a plan that leaves it out. */
const sandockForThisSpace = async () => {
  const config = resolveSandockConfig();
  if (!config) {
    throw new Error(
      "This Busabase has no sandbox configured. An administrator can set SANDOCK_API_KEY to turn it on.",
    );
  }
  const lock = await resolveContextAirAppEngineLock();
  if (lock?.lockedEngines.includes("remote")) {
    throw new Error(`Running code in a sandbox needs the ${lock.planLabel} plan.`);
  }
  return config;
};

export const startSandboxFunction = async (
  call: WorkflowSandboxCall,
): Promise<{ sandboxId: string }> => {
  const packages = parseSandboxPackages(call.packages);
  const config = await sandockForThisSpace();
  const api = sandockClient(config);
  const created = await api.sandbox.create({
    title: `Workflow step ${call.stepId}`,
    // Typed as required, but the server falls back to its default image.
    image: config.image as string,
    spaceId: config.spaceId,
    cpu: SANDBOX_CPU_MILLICORES,
    memory: SANDBOX_MEMORY_LIMIT_MB,
    command: ["/bin/sh", "-c", "sleep infinity"],
    activeDeadlineSeconds: SANDBOX_DEADLINE_SECONDS,
  });
  const sandboxId = created.data.id;
  try {
    await api.sandbox.start(sandboxId);
    const prepared = await api.sandbox.shell(sandboxId, {
      cmd: `rm -rf ${STEP_DIR} && mkdir -p ${STEP_DIR} && cd ${STEP_DIR} && echo '{"private":true,"type":"module"}' > package.json`,
      timeoutMs: 30_000,
    });
    if (prepared.data.exitCode !== 0) {
      throw new Error(
        `Could not prepare the sandbox: ${String(prepared.data.stderr).slice(0, 300)}`,
      );
    }
    const python = call.language === "python";
    await api.fs.write(sandboxId, `${STEP_DIR}/input.json`, JSON.stringify(call.input ?? null));
    await api.fs.write(sandboxId, `${STEP_DIR}/${python ? "code.py" : "code.js"}`, call.code);
    await api.fs.write(
      sandboxId,
      `${STEP_DIR}/${python ? "main.py" : "main.mjs"}`,
      python ? PYTHON_RUNNER : JAVASCRIPT_RUNNER,
    );
    await api.fs.write(sandboxId, `${STEP_DIR}/run.sh`, runScript(call, packages));
    // Detached: `shell` returns when its command exits, and installing plus
    // running can take minutes. `setsid` keeps the runner alive after this
    // call returns.
    const started = await api.sandbox.shell(sandboxId, {
      cmd: `setsid sh ${STEP_DIR}/run.sh < /dev/null > /dev/null 2>&1 &`,
      timeoutMs: 30_000,
    });
    if (started.data.exitCode !== 0) {
      throw new Error(`Could not start the code: ${String(started.data.stderr).slice(0, 300)}`);
    }
    return { sandboxId };
  } catch (error) {
    await api.sandbox.delete(sandboxId).catch(() => undefined);
    throw error;
  }
};

const tail = (text: string, chars: number): string =>
  text.length > chars ? `…${text.slice(-chars)}` : text;

const readOptional = async (
  api: ReturnType<typeof sandockClient>,
  sandboxId: string,
  name: string,
): Promise<string> => {
  try {
    return (await api.fs.read(sandboxId, `${STEP_DIR}/${name}`)).data.content ?? "";
  } catch {
    return "";
  }
};

export const pollSandboxFunction = async (sandboxId: string): Promise<WorkflowSandboxPoll> => {
  const config = resolveSandockConfig();
  if (!config) {
    return { done: true, ok: false, message: "The sandbox is no longer configured", logs: "" };
  }
  const api = sandockClient(config);
  const done = (await readOptional(api, sandboxId, "done")).trim();
  if (!done) return { done: false };
  const [phase, status] = done.split(/\s+/);
  if (phase === "install") {
    const log = tail((await readOptional(api, sandboxId, "install.log")).trim(), 1500);
    const message =
      status === "124"
        ? `Installing packages took longer than ${INSTALL_TIMEOUT_SECONDS / 60} minutes`
        : `Installing packages failed${log ? `: ${log}` : ""}`;
    return { done: true, ok: false, message, logs: log };
  }
  const resultText = await readOptional(api, sandboxId, "result.json");
  if (resultText) {
    try {
      const parsed = JSON.parse(resultText) as {
        ok?: boolean;
        result?: unknown;
        error?: string;
        logs?: string;
      };
      const logs = typeof parsed.logs === "string" ? parsed.logs : "";
      return parsed.ok
        ? { done: true, ok: true, result: parsed.result ?? null, logs }
        : { done: true, ok: false, message: parsed.error ?? "The code failed", logs };
    } catch {
      // A result cut off mid-write: fall through to the process's own output.
    }
  }
  const output = tail((await readOptional(api, sandboxId, "run.log")).trim(), 1500);
  const message =
    status === "124"
      ? "The code ran out of time"
      : `The code exited with status ${status ?? "unknown"}${output ? `: ${output}` : ""}`;
  return { done: true, ok: false, message, logs: output };
};

/** Remove the machine. Safe to call twice, and never throws: the provider reaps it anyway. */
export const stopSandboxFunction = async (sandboxId: string): Promise<void> => {
  const config = resolveSandockConfig();
  if (!config) return;
  await sandockClient(config)
    .sandbox.delete(sandboxId)
    .catch(() => undefined);
};
