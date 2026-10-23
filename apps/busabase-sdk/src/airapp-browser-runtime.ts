/**
 * Where am I running? — the browser half, answered by the app's own server.
 *
 * Busabase spawns an AirApp's process in every runtime it hosts and injects
 * `BUSABASE_AIRAPP_RUNTIME` — any non-empty value. Nobody else sets it, so its
 * absence is the positive fact "standalone". The browser cannot read env vars,
 * so the app's server re-exposes the answer at `__airapp/runtime`
 * (`describeBusabaseAirAppRuntime()` from `busabase-sdk/airapp-node` builds that
 * body) and this module reads it.
 *
 * 64 templates each carried their own copy of this probe as `app/js/runtime.js`.
 * Every rule below is one of those copies' long comments, kept because each
 * records a bug that shipped:
 *
 * - **Never the URL.** It replaced a loopback-hostname test (plus iframe nesting
 *   and the `/api/airapp-preview/` path), which misfires both ways: a hosted
 *   AirApp is served from `localhost` on Desktop and OSS, and a standalone run is
 *   routinely reached over a LAN IP or a signed dev tunnel such as
 *   `https://3111-….dev.budaapps.com` — where the app decided it was hosted,
 *   skipped its own connect gate, called `/api/v1` with no credential, and
 *   reported an error the operator could not act on.
 * - **Relative path.** Under the Local Node engine the app is served from a
 *   sub-path of Busabase's origin; a leading slash would resolve against that
 *   origin's root and 404.
 * - **JSON content-type.** A hosted origin's catch-all route can answer 200 with
 *   an HTML shell, which `response.ok` alone reads as a successful probe.
 * - **3 s timeout.** A hung probe must not hold the app (or a module graph that
 *   top-level-awaits this) open forever. It degrades to `unknown`.
 * - **Presence, never membership.** `hosted` is the server's own boolean. A
 *   browser-side list of engine names is a second, staler opinion — the copy
 *   that used to sit in these files still named `local-node`, retired two
 *   renames ago, and would have overridden the server the day its field went
 *   missing.
 * - **Three outcomes, never two.** `hosted`, `standalone`, and `unknown` (the
 *   probe did not answer). `unknown` reports `hosted: false` and
 *   `determined: false`, so each caller can pick its own safe side — for the
 *   connect gate that is "show it": an unnecessary gate is closed by the
 *   operator, a missing one strands them.
 *
 * Browser-safe: no Node imports. `fetch` is the only global it touches, and it
 * can be injected.
 */

// TYPE-ONLY: `airapp-node` reads `process.env` and the filesystem. `import type`
// is erased at build time, so the browser bundle gets nothing from it — only the
// server's body shape stays single-sourced.
import type { BusabaseAirAppRuntimeReport } from "./airapp-node.js";

/** What the probe resolved to. */
export interface AirAppRuntimeInfo {
  /**
   * The engine name the server reported, verbatim (`"browser"`, `"local"`,
   * `"standalone"`, or one this SDK has never heard of), or `"unknown"` when the
   * probe did not get an answer.
   */
  runtime: string;
  /** Busabase is hosting this app. Taken from the server's boolean, never derived here. */
  hosted: boolean;
  /**
   * A standalone run is proxying `/api/v1` to a configured Busabase base URL.
   * A separate axis from `hosted` — "where am I" is not "do I have credentials".
   */
  devProxy: boolean;
  /** `false` when the probe did not answer — the `unknown` outcome. */
  determined: boolean;
}

/** Relative on purpose; see the module comment. */
export const AIRAPP_RUNTIME_PATH = "__airapp/runtime";

/** How long the probe waits before resolving to `unknown`. */
export const AIRAPP_RUNTIME_TIMEOUT_MS = 3000;

/** The `unknown` outcome: the probe did not get a usable answer. */
export const AIRAPP_RUNTIME_UNKNOWN: Readonly<AirAppRuntimeInfo> = Object.freeze({
  runtime: "unknown",
  hosted: false,
  devProxy: false,
  determined: false,
});

/**
 * Turn a `__airapp/runtime` body into an {@link AirAppRuntimeInfo}. Anything that
 * is not an object with a string `runtime` is `unknown`.
 *
 * `hosted` is `body.hosted === true` — the server's own answer, read as-is.
 */
export function normalizeAirAppRuntime(
  body: Partial<BusabaseAirAppRuntimeReport> | unknown,
): AirAppRuntimeInfo {
  if (!body || typeof body !== "object") return { ...AIRAPP_RUNTIME_UNKNOWN };
  const report = body as Partial<BusabaseAirAppRuntimeReport>;
  if (typeof report.runtime !== "string") return { ...AIRAPP_RUNTIME_UNKNOWN };
  return {
    runtime: report.runtime,
    hosted: report.hosted === true,
    devProxy: report.devProxy === true,
    determined: true,
  };
}

export interface DetectAirAppRuntimeOptions {
  /**
   * Injected `fetch`. When set, the probe always runs fresh and nothing is
   * cached — it is a different question from "what did this page's probe say".
   */
  fetch?: typeof globalThis.fetch;
  /** Defaults to {@link AIRAPP_RUNTIME_TIMEOUT_MS}. */
  timeoutMs?: number;
}

const probe = async (
  doFetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<AirAppRuntimeInfo> => {
  // An AbortController rather than `AbortSignal.timeout`, so the timer is cleared
  // the moment the answer arrives and the timeout also covers reading the body.
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await doFetch(AIRAPP_RUNTIME_PATH, {
      headers: { accept: "application/json" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("application/json")) return { ...AIRAPP_RUNTIME_UNKNOWN };
    return normalizeAirAppRuntime(await response.json());
  } catch {
    return { ...AIRAPP_RUNTIME_UNKNOWN };
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
};

/**
 * The page-wide answer lives on a global slot, not in module scope: an app that
 * imports its modules both with and without a `?v=` cache-busting query loads
 * this file as two module records with two scopes. A module-level cache would be
 * filled by one copy and read empty by the other — the bug one template already
 * hit with its own copy of this probe.
 */
const SLOT = Symbol.for("busabase-sdk.airapp.runtime");
type RuntimeSlot = { pending?: Promise<AirAppRuntimeInfo> };
const slot = (): RuntimeSlot => {
  const holder = globalThis as unknown as Record<symbol, RuntimeSlot | undefined>;
  let current = holder[SLOT];
  if (!current) {
    current = {};
    holder[SLOT] = current;
  }
  return current;
};

/**
 * Ask the app's own server where it is running. Never rejects: a failed,
 * non-JSON, or slow probe resolves to {@link AIRAPP_RUNTIME_UNKNOWN}.
 *
 * Called without an injected `fetch`, the first call probes and every later call
 * on the page shares that answer, so the connect gate, the provider, and the
 * settings panel can each ask without three round trips.
 *
 * @example
 * ```js
 * // app/js/runtime.js
 * import { detectAirAppRuntime, shouldUseLocalAirAppGateway } from "../vendor/busabase-airapp.js";
 *
 * export const runtime = await detectAirAppRuntime();
 * export const shouldUseLocalGateway = () => shouldUseLocalAirAppGateway(runtime);
 * ```
 */
export function detectAirAppRuntime(
  options: DetectAirAppRuntimeOptions = {},
): Promise<AirAppRuntimeInfo> {
  const timeoutMs = options.timeoutMs ?? AIRAPP_RUNTIME_TIMEOUT_MS;
  if (options.fetch) return probe(options.fetch, timeoutMs);
  const shared = slot();
  if (!shared.pending) {
    // Resolved at call time, not import time, so a test or polyfill that installs
    // `fetch` after this module loads is still the one used.
    shared.pending =
      typeof globalThis.fetch === "function"
        ? probe(globalThis.fetch.bind(globalThis), timeoutMs)
        : Promise.resolve({ ...AIRAPP_RUNTIME_UNKNOWN });
  }
  return shared.pending;
}

/**
 * Whether the app's local `/auth/*` connect gate applies — the predicate for
 * `createAirAppConnectGate({ shouldGate })`.
 *
 * `!hosted`, so `unknown` shows the gate: an unnecessary gate is closed by the
 * operator, a missing one strands them. Where the app runs never decides whether
 * a write merges — Busabase decides that from the person's own permission.
 */
export const shouldUseLocalAirAppGateway = (runtime: AirAppRuntimeInfo): boolean => !runtime.hosted;
