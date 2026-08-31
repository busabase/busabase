/**
 * What an AirApp needs in order to start, and how Busabase works that out.
 *
 * The design rule this file exists to enforce: **engines never branch on a
 * language.** An AirApp, from the user's side, is "run some commands, a port
 * opens, a web page appears" — nothing in that sentence mentions Node or
 * Python, so nothing downstream of here should either. Every engine consumes a
 * `RunPlan`; only this module knows that `node` and `python` are different.
 *
 * That inverts the obvious implementation. Hardcoding `npm install` /
 * `npm run dev` in each engine (which is what shipped before this) means a
 * second language has to be threaded through the install command, the start
 * command, the ready-port patterns, the sandbox network allowlist and the
 * write-time validator — five places, in two engines, that must all be found
 * again for a third language. Producing one `RunPlan` up front collapses all of
 * it: adding a language is a new `AirAppRuntimeDescriptor` in `RUNTIMES` below,
 * and no existing branch is edited.
 *
 * PURITY: this module is isomorphic and must stay that way. The `browser`
 * engine resolves its own plan (it runs in a Web Worker, with no server round
 * trip), the engine picker needs eligibility on the client, and the server-side
 * engines resolve the same plan from the same code. So: no `node:*` imports, no
 * `~/db`, no `server-only`.
 */

import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";

/** A language/toolchain an AirApp can be written in. */
export type AirAppRuntimeKind = "node" | "python";

/** Optional, and absent from every AirApp written before this file existed. */
export const AIRAPP_MANIFEST_PATH = "airapp.json";

/**
 * Placeholder substituted with the port the engine allocated, at spawn time.
 *
 * Node apps read `process.env.PORT` by convention, so they never needed this.
 * Most other stacks don't: `uvicorn` takes `--port`, and silently binds 8000 if
 * you only set an environment variable it doesn't read. Injecting `PORT` into
 * the environment is therefore necessary but not sufficient — the placeholder
 * is what lets a start command put the number where its own CLI wants it.
 */
export const PORT_PLACEHOLDER = "$PORT";

/** What an AirApp author may declare in `airapp.json`. Every field is optional. */
export interface AirAppManifest {
  runtime?: AirAppRuntimeKind;
  install?: string;
  start?: string;
  port?: number;
  /**
   * Advisory, not binding — see `preferredEngine` handling in the picker. An
   * app that pins an engine this deployment hasn't configured still runs on
   * whatever else is eligible, rather than becoming unrunnable.
   */
  preferredEngine?: AirAppRunnerKind;
}

/** How the runtime was decided — surfaced in the Logs tab so inference is never invisible. */
export type RunPlanSource = "manifest" | "inferred" | "default";

/** The complete, engine-agnostic instruction set for starting one AirApp. */
export interface RunPlan {
  runtime: AirAppRuntimeKind;
  install: string;
  start: string;
  /** Declared by the author. When absent the engine sniffs `readyPatterns`. */
  port?: number;
  readyPatterns: RegExp[];
  /**
   * Directories, relative to the run's workdir, to prepend to `PATH`.
   *
   * Kept relative because this module must not know where a run lands on disk;
   * the engine joins them against its own workdir. Used to put a per-run
   * virtualenv's `bin/` ahead of the system one, which is what makes the start
   * command find the dependencies the install command just installed —
   * *without* either command hardcoding a path, so an app that overrides one of
   * them still works.
   */
  pathPrepend: string[];
  preferredEngine?: AirAppRunnerKind;
  source: RunPlanSource;
  /** One human-readable sentence for the Logs tab. */
  explanation: string;
}

/**
 * Ready-port patterns shared by every runtime. A port in a log line looks the
 * same whichever language printed it, so these are matched for all runtimes and
 * each descriptor only adds what is genuinely specific to its ecosystem.
 */
const COMMON_READY_PATTERNS: RegExp[] = [
  /listening on port\s*:?\s*(\d{2,5})/i,
  /localhost:(\d{2,5})/i,
  /0\.0\.0\.0:(\d{2,5})/i,
  /127\.0\.0\.1:(\d{2,5})/i,
  /listening on\s*:?\s*(\d{2,5})/i,
];

export interface AirAppRuntimeDescriptor {
  kind: AirAppRuntimeKind;
  /** Files whose presence implies this runtime, most specific first. */
  markerFiles: string[];
  /**
   * `null` means "runs anywhere". `"os-process"` means the engine must be a
   * real OS process — which is how the `browser` engine (a JavaScript runtime
   * inside a browser tab) is excluded without any engine needing to know that
   * Python exists.
   */
  requiresExecutionModel: "os-process" | null;
  readyPatterns: RegExp[];
  pathPrepend: string[];
  /**
   * Defaults for a file tree already known to be this runtime. Takes the tree
   * because the right command can depend on which marker file is present —
   * `pip install -r requirements.txt` is wrong for a `pyproject.toml` project.
   */
  defaults(files: ReadonlySet<string>): { install: string; start: string };
}

const NODE_RUNTIME: AirAppRuntimeDescriptor = {
  kind: "node",
  markerFiles: ["package.json"],
  requiresExecutionModel: null,
  readyPatterns: COMMON_READY_PATTERNS,
  // npm already puts `node_modules/.bin` on PATH for `npm run`, so nothing to add.
  pathPrepend: [],
  defaults: () => ({ install: "npm install", start: "npm run dev" }),
};

const PYTHON_RUNTIME: AirAppRuntimeDescriptor = {
  kind: "python",
  markerFiles: ["requirements.txt", "pyproject.toml"],
  // CPython is a real binary. The browser engine cannot host it under any
  // configuration.
  requiresExecutionModel: "os-process",
  readyPatterns: [
    ...COMMON_READY_PATTERNS,
    // Uvicorn/Hypercorn print a full URL; Flask's dev server prints "Running on".
    /running on https?:\/\/[^\s:]+:(\d{2,5})/i,
  ],
  // The venv's bin goes first, so the start command's `python3` is the one the
  // install command populated. Nothing hardcodes the path, so an app that
  // overrides only `install` still starts (its `python3` simply resolves to the
  // system one), and an app that overrides only `start` still sees its deps.
  pathPrepend: [".venv/bin"],
  /**
   * Two host realities decided these commands, both found by running them
   * rather than by reading docs:
   *
   *  - **`python` and `pip` frequently do not exist.** Debian/Ubuntu ship
   *    `python3` with no `python` shim, and `pip` is often a separate package.
   *    The failure is a bare `spawn python ENOENT` naming nothing the author
   *    did wrong. So: `python3`, and `-m pip` rather than `pip`.
   *  - **A system-wide `pip install` is refused outright** on any host
   *    following PEP 668 — Debian, Ubuntu, Fedora and Homebrew Python all do,
   *    which is most of them. `error: externally-managed-environment` is not
   *    something an AirApp author can act on. So every run builds its own
   *    virtualenv inside its own (already per-run, already disposable) workdir.
   *
   * `sh -c` because this is genuinely two commands; the argv tokenizer does not
   * interpret `&&`, and should not — quoting it into a shell is explicit about
   * the fact that a shell is what runs it.
   */
  defaults: (files) => ({
    install: files.has("requirements.txt")
      ? 'sh -c "python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"'
      : // A `pyproject.toml` project installs itself; `-e` keeps edits live so a
        // restart picks up source changes without reinstalling.
        'sh -c "python3 -m venv .venv && .venv/bin/python -m pip install -e ."',
    // Bind 0.0.0.0, not localhost: under the reverse proxy the connection
    // arrives from outside the app's own loopback, and a remote engine reaches
    // it from outside the container's. A default of 127.0.0.1 produces a server
    // that logs success and refuses every proxied request.
    start: `python3 -m uvicorn main:app --host 0.0.0.0 --port ${PORT_PLACEHOLDER}`,
  }),
};

/**
 * The runtime registry — one of exactly two legitimate "list the concrete
 * implementations" sites in this design (the other is `runner-factory.ts`).
 * Order matters for inference: the first descriptor whose marker file is
 * present wins.
 *
 * `node` is deliberately last. An app carrying both `package.json` and
 * `requirements.txt` is far more likely to be a Python app with a JS asset
 * pipeline than the reverse, and every AirApp that predates this file has a
 * `package.json` — so putting node first would make the marker meaningless.
 * The tie is reported in `explanation` either way.
 */
export const RUNTIMES: AirAppRuntimeDescriptor[] = [PYTHON_RUNTIME, NODE_RUNTIME];

export const getRuntimeDescriptor = (kind: AirAppRuntimeKind): AirAppRuntimeDescriptor => {
  const found = RUNTIMES.find((runtime) => runtime.kind === kind);
  if (!found) throw new Error(`Unknown AirApp runtime: ${kind}`);
  return found;
};

/** How each engine executes a command — the other half of the eligibility rule. */
export const ENGINE_EXECUTION_MODEL: Record<AirAppRunnerKind, "browser-js" | "os-process"> = {
  browser: "browser-js",
  local: "os-process",
  // A provisioned machine is still a real machine: it runs whatever the RunPlan
  // says, with no per-language support to add. That is why `remote` shares
  // `os-process` rather than getting a model of its own — the axis that matters
  // here is "can this execute a binary", not "whose box is it".
  remote: "os-process",
};

/**
 * Eligibility as a predicate over two independently-declared properties, never
 * a matrix. Encoding it as `runtime.supportedEngines` would mean editing every
 * runtime to add an engine; `engine.supportedRuntimes` would mean editing every
 * engine to add a language. Both rot, in opposite directions. This rots in
 * neither: each side declares only its own property.
 */
export const isEngineEligible = (engine: AirAppRunnerKind, runtime: AirAppRuntimeKind): boolean => {
  const required = getRuntimeDescriptor(runtime).requiresExecutionModel;
  return required === null || ENGINE_EXECUTION_MODEL[engine] === required;
};

/**
 * Pick the engine to actually run with, given the user's/app's wish and what
 * this deployment offers.
 *
 * Needed because opening an AirApp auto-runs it: a Python app whose selected
 * engine defaulted to the constant `"browser"` would auto-start on the one
 * engine guaranteed to fail, before the user could touch anything. Returns
 * `null` when nothing available can run this app, which the caller must render
 * as an explicit "this deployment can't run this app" state rather than
 * attempting a run that cannot succeed.
 */
export const resolveEngine = (
  runtime: AirAppRuntimeKind,
  wanted: AirAppRunnerKind,
  available: readonly AirAppRunnerKind[],
): AirAppRunnerKind | null => {
  if (available.includes(wanted) && isEngineEligible(wanted, runtime)) return wanted;
  return available.find((engine) => isEngineEligible(engine, runtime)) ?? null;
};

/**
 * Replace `$PORT` in a command. Applied after tokenization would be wrong (the
 * placeholder can be glued to other characters, e.g. `:$PORT`), so it runs on
 * the raw string first.
 */
export const substitutePort = (command: string, port: number): string =>
  command.split(PORT_PLACEHOLDER).join(String(port));

/**
 * Split a command line into argv, respecting quotes.
 *
 * The previous implementation was `command.split(" ")`, which is correct for
 * exactly the two hardcoded commands it was written for and wrong for anything
 * an author writes: `python -c "import app; app.run()"` became five bogus
 * arguments. Any command that survives quoting round-trips here instead.
 */
export const tokenizeCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        index += 1;
        current += command[index];
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is still an argument ("" must not vanish).
      hasContent = true;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      current += command[index];
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0 || hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }

  if (current.length > 0 || hasContent) tokens.push(current);
  return tokens;
};

/**
 * Engine names an `airapp.json` in the wild may still carry.
 *
 * The values were renamed from product names (`nodepod`, `sandock`) to the
 * location they actually describe. An AirApp's manifest is a file in somebody
 * else's repository, though — Busabase does not own it and cannot rewrite it —
 * so an app pinned to the old name must keep resolving rather than fail
 * validation on a rename it had no part in. Accepting both spellings costs one
 * lookup; rejecting the old one costs every previously-authored app.
 */
const LEGACY_ENGINE_ALIASES: Record<string, AirAppRunnerKind> = {
  nodepod: "browser",
  sandock: "remote",
  // Predates `nodepod` -> `browser`; still found in the oldest manifests.
  "local-node": "local",
};

/** Removed engine — rejected with its own message rather than as "unknown". */
const RETIRED_ENGINE = "srt";

const PREFERRED_ENGINE_ERROR = `\`airapp.json\`'s \`preferredEngine\` must be one of ${Object.keys(ENGINE_EXECUTION_MODEL).join(", ")}`;

const parseManifest = (raw: string): { manifest: AirAppManifest } | { error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "`airapp.json` is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "`airapp.json` must be a JSON object" };
  }
  const candidate = parsed as Record<string, unknown>;

  const runtime = candidate.runtime;
  if (runtime !== undefined) {
    if (typeof runtime !== "string" || !RUNTIMES.some((entry) => entry.kind === runtime)) {
      return {
        error: `\`airapp.json\` declares unknown runtime ${JSON.stringify(runtime)} (expected ${RUNTIMES.map((entry) => `"${entry.kind}"`).join(" or ")})`,
      };
    }
  }
  for (const key of ["install", "start"] as const) {
    const value = candidate[key];
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      return { error: `\`airapp.json\`'s \`${key}\` must be a non-empty string` };
    }
  }
  const port = candidate.port;
  if (port !== undefined) {
    if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port >= 65536) {
      return { error: "`airapp.json`'s `port` must be an integer between 1 and 65535" };
    }
  }
  const preferredEngine = candidate.preferredEngine;
  let normalizedEngine: AirAppRunnerKind | undefined;
  if (preferredEngine !== undefined) {
    if (typeof preferredEngine !== "string") {
      return { error: PREFERRED_ENGINE_ERROR };
    }
    if (preferredEngine === RETIRED_ENGINE) {
      // Named separately from "unknown value" because the author did not
      // guess — this engine existed, and the reason it stopped is worth one
      // sentence rather than a list of valid values they must diff against.
      return {
        error: `\`airapp.json\` declares \`preferredEngine: "srt"\`, an engine that has been removed: it network-isolated the process, so its port was never reachable for preview. Use "remote" for isolated execution, or delete the field.`,
      };
    }
    const resolved = LEGACY_ENGINE_ALIASES[preferredEngine] ?? preferredEngine;
    if (!Object.hasOwn(ENGINE_EXECUTION_MODEL, resolved)) {
      return { error: PREFERRED_ENGINE_ERROR };
    }
    normalizedEngine = resolved as AirAppRunnerKind;
  }

  return {
    manifest: {
      ...(candidate as AirAppManifest),
      ...(normalizedEngine ? { preferredEngine: normalizedEngine } : {}),
    },
  };
};

/** Thrown for a malformed `airapp.json`. A bad manifest is an authoring error worth surfacing. */
export class AirAppManifestError extends Error {}

/**
 * Parse + validate an `airapp.json` on its own, for the write-time check —
 * which sees only the files in one request and so cannot resolve a whole plan.
 */
export const parseAirAppManifest = (raw: string): AirAppManifest => {
  const result = parseManifest(raw);
  if ("error" in result) throw new AirAppManifestError(result.error);
  return result.manifest;
};

/**
 * Turn a file tree into the plan for running it.
 *
 * Resolution order is explicit-then-inferred, and never fails closed on a
 * missing manifest: an agent that forgot to write `airapp.json` should produce
 * an app that still runs, not one the reviewer has to debug on the agent's
 * behalf. Every AirApp written before this feature existed therefore keeps
 * working with no migration — it infers `node` from its `package.json` and gets
 * byte-identical commands to the ones that used to be hardcoded.
 */
export const resolveRunPlan = (files: Record<string, unknown>): RunPlan => {
  const present = new Set(Object.keys(files));
  const rawManifest = files[AIRAPP_MANIFEST_PATH];

  let manifest: AirAppManifest = {};
  if (typeof rawManifest === "string") {
    const result = parseManifest(rawManifest);
    if ("error" in result) throw new AirAppManifestError(result.error);
    manifest = result.manifest;
  }

  let runtime: AirAppRuntimeKind;
  let source: RunPlanSource;
  let explanation: string;

  if (manifest.runtime) {
    runtime = manifest.runtime;
    source = "manifest";
    explanation = `runtime "${runtime}" declared in ${AIRAPP_MANIFEST_PATH}`;
  } else {
    const matched = RUNTIMES.find((entry) =>
      entry.markerFiles.some((marker) => present.has(marker)),
    );
    if (matched) {
      const marker = matched.markerFiles.find((candidate) => present.has(candidate));
      runtime = matched.kind;
      source = "inferred";
      const ambiguous = RUNTIMES.filter((entry) =>
        entry.markerFiles.some((candidate) => present.has(candidate)),
      );
      // Inference runs in two different situations and they must not read the
      // same. A manifest that exists but declares no `runtime` used to be
      // reported as "no airapp.json", which is a log line stating something the
      // reader can verify is false — it sent someone debugging a manifest that
      // was in fact being read correctly. Say which case this is.
      const manifestState = present.has(AIRAPP_MANIFEST_PATH)
        ? `${AIRAPP_MANIFEST_PATH} declares no "runtime"`
        : `no ${AIRAPP_MANIFEST_PATH}`;
      explanation =
        ambiguous.length > 1
          ? `${manifestState}; inferred "${runtime}" from ${marker} (also saw ${ambiguous
              .filter((entry) => entry.kind !== runtime)
              .map((entry) => entry.kind)
              .join(", ")} markers — declare "runtime" to override)`
          : `${manifestState}; inferred "${runtime}" from ${marker}`;
    } else {
      runtime = "node";
      source = "default";
      explanation = present.has(AIRAPP_MANIFEST_PATH)
        ? `${AIRAPP_MANIFEST_PATH} declares no "runtime" and no runtime marker file is present; defaulting to "node"`
        : `no ${AIRAPP_MANIFEST_PATH} and no runtime marker file; defaulting to "node"`;
    }
  }

  const descriptor = getRuntimeDescriptor(runtime);
  const defaults = descriptor.defaults(present);

  return {
    runtime,
    install: manifest.install ?? defaults.install,
    start: manifest.start ?? defaults.start,
    port: manifest.port,
    readyPatterns: descriptor.readyPatterns,
    pathPrepend: descriptor.pathPrepend,
    preferredEngine: manifest.preferredEngine,
    source,
    explanation,
  };
};
