/**
 * `/api/health/deep` — the generic half. (`/api/health` stays the shallow, public endpoint
 * Kubernetes probes and Docker HEALTHCHECK use: liveness and readiness must never depend on a
 * shared dependency, or one blip restarts or unroutes every pod at once.)
 *
 * The deep check runs each app's named dependency probes in parallel, each under a hard
 * timeout, and reports `ok` / `error` / `skipped` per dependency. A dependency the deployment
 * has not configured (e.g. no CMS env vars) is `skipped`, never a failure. It is for
 * monitoring and alerting, not for probes.
 *
 * It describes the infrastructure, so it is not public: a request must carry
 * `Authorization: Bearer <HEALTH_CHECK_TOKEN>`. Without the variable set, or with a missing or
 * wrong token, it answers 404 as if it did not exist — before any probe runs. Results are
 * cached at module level and concurrent callers share ONE in-flight probe run, so even an
 * authorised caller polling hard cannot multiply load on the dependencies. Its `error` field
 * is a short class (`timeout`, `ECONNREFUSED`, `HTTP 401`), never a raw message.
 *
 * Each app only wires the probes for the dependencies it has (in its
 * `src/app/api/health/deep/route.ts`); the probes themselves live in `./health-probes`.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type HealthCheckStatus = "ok" | "error" | "skipped";

/** Returned by a probe whose dependency is not configured in this deployment. */
export const HEALTH_PROBE_SKIPPED = "skipped";

/**
 * One dependency check. Resolve (with nothing) when the dependency answered, resolve
 * `HEALTH_PROBE_SKIPPED` when it is not configured here, throw when it is broken.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` lets a plain `async () => { await x; }` be a probe; `undefined` would reject its inferred Promise<void>.
export type HealthProbe = () => Promise<void | typeof HEALTH_PROBE_SKIPPED>;

export interface HealthCheckResult {
  status: HealthCheckStatus;
  latencyMs: number;
  /** Sanitised failure class — only present when `status` is `error`. */
  error?: string;
}

export interface DeepHealthReport {
  status: "ok" | "error";
  service: string;
  checkedAt: string;
  /** True when this response reused a report from the last `cacheTtlMs`. */
  cached: boolean;
  checks: Record<string, HealthCheckResult>;
}

export interface DeepHealthCheckOptions {
  /** Service label echoed in the report (matches `/api/health`'s `service`). */
  service: string;
  /** Named probes; the names become the keys of `checks`. */
  probes: Record<string, HealthProbe>;
  /** Hard per-probe deadline. Defaults to 2s. */
  timeoutMs?: number;
  /** How long a finished report is reused. Defaults to 10s. */
  cacheTtlMs?: number;
}

export interface DeepHealthCheck {
  /** The current report: cached when fresh, otherwise one shared probe run. */
  run: () => Promise<DeepHealthReport>;
  /**
   * `run()` as an HTTP response: 200 when every configured check passed, else 503 — or 404
   * without the right `Authorization: Bearer <HEALTH_CHECK_TOKEN>` (see the module comment).
   */
  respond: (request: Request) => Promise<Response>;
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/** The environment variable holding the deep check's bearer token. */
export const HEALTH_CHECK_TOKEN_ENV = "HEALTH_CHECK_TOKEN";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether `request` carries `Authorization: Bearer <token>` for a configured, non-empty token.
 * Both sides are hashed first, so the comparison is constant-time whatever their lengths.
 */
export const isHealthCheckAuthorized = (
  request: Request,
  token: string | undefined = process.env[HEALTH_CHECK_TOKEN_ENV],
): boolean => {
  const expected = token?.trim();
  if (!expected) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
};

/** What an unauthorised caller sees: the same 404 as a path that does not exist. */
const notFoundResponse = (): Response =>
  new Response("Not Found", { status: 404, headers: NO_STORE_HEADERS });

export const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 2_000;
export const DEFAULT_HEALTH_CACHE_TTL_MS = 10_000;

/** Error classes are short identifiers; anything else is collapsed to `error`. */
const SAFE_REASON = /^[A-Za-z0-9_]{1,64}$/;
/** `code` values worth surfacing: errno names (ECONNREFUSED), SQLSTATEs (28P01), UND_ERR_*. */
const SAFE_CODE = /^[A-Z0-9_]{2,64}$/;
const MAX_CAUSE_DEPTH = 5;

/**
 * A failure whose class the probe already knows (e.g. `not_found`, `unavailable`). The reason
 * is reported verbatim when it is a plain identifier, and as `error` otherwise.
 */
export class HealthProbeError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HealthProbeError";
    this.reason = SAFE_REASON.test(reason) ? reason : "error";
  }
}

class HealthProbeTimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "HealthProbeTimeoutError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isHttpStatus = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;

/** HTTP status as carried by fetch-style, oRPC, and AWS SDK errors. */
const httpStatusOf = (error: Record<string, unknown>): number | undefined => {
  const metadata = isRecord(error.$metadata) ? error.$metadata : undefined;
  const response = isRecord(error.response) ? error.response : undefined;
  return [error.status, error.statusCode, metadata?.httpStatusCode, response?.status].find(
    isHttpStatus,
  );
};

/**
 * Reduce any thrown value to a short, public-safe class. Only structured fields are read —
 * never `message` — walking the `cause` chain (drizzle wraps the driver error, fetch wraps the
 * socket error). Preference per error: timeout, HTTP status, `code`; the first non-generic
 * error `name` is the fallback, then `error`.
 */
export const sanitizeHealthError = (error: unknown): string => {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let fallbackName: string | undefined;

  for (let depth = 0; isRecord(current) && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    if (current instanceof HealthProbeTimeoutError) return "timeout";
    if (current instanceof HealthProbeError) return current.reason;

    const name = typeof current.name === "string" ? current.name : undefined;
    if (name && /timeout/i.test(name)) return "timeout";
    if (name === "AbortError") return "aborted";

    const status = httpStatusOf(current);
    if (status !== undefined) return `HTTP ${status}`;

    if (typeof current.code === "string" && SAFE_CODE.test(current.code)) return current.code;

    if (!fallbackName && name && name !== "Error" && SAFE_REASON.test(name)) fallbackName = name;
    current = current.cause;
  }

  return fallbackName ?? "error";
};

const elapsedSince = (startedAt: number): number => Math.round(performance.now() - startedAt);

const runProbe = async (
  service: string,
  name: string,
  probe: HealthProbe,
  timeoutMs: number,
): Promise<HealthCheckResult> => {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HealthProbeTimeoutError()), timeoutMs);
  });

  try {
    // `.then(probe)` turns a synchronous throw into a rejection. A probe that loses the race
    // keeps running in the background; `Promise.race` has already subscribed to it, so its
    // late rejection is handled rather than reported as unhandled.
    const outcome = await Promise.race([Promise.resolve().then(probe), deadline]);
    return {
      status: outcome === HEALTH_PROBE_SKIPPED ? "skipped" : "ok",
      latencyMs: elapsedSince(startedAt),
    };
  } catch (error) {
    const reason = sanitizeHealthError(error);
    // The response carries only the class; the server log keeps the detail for operators.
    console.warn(`[health] ${service} ${name} check failed: ${reason}`, error);
    return { status: "error", latencyMs: elapsedSince(startedAt), error: reason };
  } finally {
    clearTimeout(timer);
  }
};

/** 200 when every configured check passed (skipped counts as passing), 503 otherwise. */
export const deepHealthResponse = (report: DeepHealthReport): Response =>
  Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: NO_STORE_HEADERS,
  });

/**
 * Build one app's deep health check. Call once at module level so the cache and the
 * in-flight run are shared by every request this server process handles.
 */
export const createDeepHealthCheck = (options: DeepHealthCheckOptions): DeepHealthCheck => {
  const { service, probes } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS;

  let lastReport: DeepHealthReport | null = null;
  let lastReportExpiresAt = 0;
  let inFlight: Promise<DeepHealthReport> | null = null;

  const probeAll = async (): Promise<DeepHealthReport> => {
    const entries = Object.entries(probes);
    const results = await Promise.all(
      entries.map(([name, probe]) => runProbe(service, name, probe, timeoutMs)),
    );
    return {
      status: results.some((result) => result.status === "error") ? "error" : "ok",
      service,
      checkedAt: new Date().toISOString(),
      cached: false,
      checks: Object.fromEntries(entries.map(([name], index) => [name, results[index]])),
    };
  };

  const run = async (): Promise<DeepHealthReport> => {
    if (lastReport && Date.now() < lastReportExpiresAt) return { ...lastReport, cached: true };

    inFlight ??= probeAll()
      .then((report) => {
        lastReport = report;
        lastReportExpiresAt = Date.now() + cacheTtlMs;
        return report;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const respond = async (request: Request): Promise<Response> => {
    // Before any probe: an unauthorised caller must not be able to trigger one.
    if (!isHealthCheckAuthorized(request)) return notFoundResponse();
    try {
      return deepHealthResponse(await run());
    } catch (error) {
      // probeAll never rejects (every probe is caught), but a health endpoint must not 500.
      console.warn(`[health] ${service} deep check crashed`, error);
      return deepHealthResponse({
        status: "error",
        service,
        checkedAt: new Date().toISOString(),
        cached: false,
        checks: {},
      });
    }
  };

  return { run, respond };
};
