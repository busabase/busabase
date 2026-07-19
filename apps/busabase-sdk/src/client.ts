import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ContractRouterClient, inferRPCMethodFromContractRouter } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { type CloudContract, cloudContract } from "busabase-contract/contract/cloud";

/**
 * The fully-typed Busabase client. Built over the *cloud* contract, which is a
 * strict superset of the OSS workbench contract (it adds the cloud-only `/api/v1`
 * endpoints: `system`, `users`, `agentTasks`). This keeps every OSS workbench
 * command working against a local server while unlocking the cloud endpoints when
 * pointed at busabase.com with an API key.
 *
 * Namespaced by domain — e.g. `client.bases.list()`, `client.records.get({ recordId })`,
 * `client.changeRequests.merge({ changeRequestId })`, `client.system.health()`.
 */
export type BusabaseClient = ContractRouterClient<CloudContract>;

/**
 * Default host when neither an explicit `baseUrl` nor `BUSABASE_BASE_URL` is set:
 * the always-on Busabase Cloud. A local server default would just refuse the
 * connection unless the desktop/OSS app is running, so a cold client reaches a
 * real server this way. For a local server, pass `baseUrl: "http://localhost:15419"`
 * (or export `BUSABASE_BASE_URL`).
 */
export const DEFAULT_BASE_URL = "https://busabase.com";

/** Options for constructing a Busabase client. Every field falls back to an env var. */
export interface BusabaseConfig {
  /**
   * Server root, e.g. `http://localhost:15419` (with or without a trailing
   * `/api/v1`). Falls back to `BUSABASE_BASE_URL`, then {@link DEFAULT_BASE_URL}.
   */
  baseUrl?: string;
  /**
   * Bearer token. Only Busabase Cloud requires it; a local OSS server is open.
   * Falls back to `BUSABASE_API_KEY`.
   */
  apiKey?: string;
  /**
   * Target Busabase Cloud space id, sent as the `x-busabase-space` header. Falls
   * back to `BUSABASE_SPACE_ID`. When omitted, no space header is sent; Cloud
   * accepts that only when the token has a single unambiguous space.
   */
  spaceId?: string;
  /**
   * Extra headers merged into every request (after auth/space headers, so these
   * win on conflict). Static object or a (possibly async) factory.
   */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Custom `fetch` implementation (e.g. a proxy-aware or instrumented fetch). */
  fetch?: typeof fetch;
}

/** A {@link BusabaseConfig} with every field resolved from env / defaults. */
export interface ResolvedConfig {
  baseUrl: string;
  apiKey?: string;
  spaceId?: string;
  headers?: BusabaseConfig["headers"];
  fetch?: typeof fetch;
}

const env = (key: string): string | undefined => {
  // Guard `process` so the SDK stays importable in a browser / edge runtime.
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
};

/**
 * Normalise a user-supplied base URL to the server root. The contract already
 * carries the `/api/v1` prefix (`OpenAPILink` appends it), so accept either form
 * (`http://host` or `http://host/api/v1`) and strip the suffix if present.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

/** Fill in missing config fields from environment variables and defaults. */
export function resolveConfig(config: BusabaseConfig = {}): ResolvedConfig {
  return {
    baseUrl: normalizeBaseUrl(config.baseUrl ?? env("BUSABASE_BASE_URL") ?? DEFAULT_BASE_URL),
    apiKey: config.apiKey ?? env("BUSABASE_API_KEY"),
    spaceId: config.spaceId ?? env("BUSABASE_SPACE_ID"),
    headers: config.headers,
    fetch: config.fetch,
  };
}

/** One entry of a Zod validation failure, as the server puts on `data.issues`
 *  for a 400 (see `Input validation failed` responses). */
interface BusabaseErrorIssue {
  path?: unknown;
  message?: unknown;
}

/**
 * The server's OpenAPI error body is a bespoke `{ error, code, data }` shape
 * (see `encodeOpenApiError` in `apps/busabase/src/app/api/v1/[[...rest]]/route.ts`),
 * not oRPC's own `{ defined, code, status, message, data }` shape. `OpenAPILink`'s
 * built-in `isORPCErrorJson` check requires the latter, so without this decoder
 * it never recognizes the body, falls back to a generic per-status message
 * ("Bad Request" / "Conflict" / …), and silently drops the server's real error
 * text — including, for a 400, the field-level `data.issues` detail entirely.
 * This reconstructs a real message from the actual body so CLI/SDK callers see
 * what the server actually said. Returning `undefined` for anything that
 * doesn't look like this shape lets `OpenAPILink` fall back to its own decoding.
 */
const decodeBusabaseError = (
  deserializedBody: unknown,
  response: { status: number },
): ORPCError<string, unknown> | undefined => {
  if (!deserializedBody || typeof deserializedBody !== "object") {
    return undefined;
  }
  const body = deserializedBody as { error?: unknown; code?: unknown; data?: unknown };
  if (typeof body.error !== "string") {
    return undefined;
  }
  const code = typeof body.code === "string" ? body.code : `HTTP_${response.status}`;
  const issues = (body.data as { issues?: unknown } | undefined)?.issues;
  let message = body.error;
  if (Array.isArray(issues) && issues.length > 0) {
    const details = (issues as BusabaseErrorIssue[])
      .map((issue) => {
        const path = Array.isArray(issue?.path) ? issue.path.join(".") : undefined;
        return path ? `${path}: ${issue?.message}` : String(issue?.message ?? issue);
      })
      .join("; ");
    message = `${message} — ${details}`;
  }
  return new ORPCError(code, { status: response.status, message, data: body.data });
};

/**
 * Build a fully-typed Busabase client over the public `/api/v1` REST surface.
 * Config fields default from `BUSABASE_BASE_URL` / `BUSABASE_API_KEY` /
 * `BUSABASE_SPACE_ID` when omitted.
 *
 * @example
 * ```ts
 * const client = createBusabaseClient({ apiKey: process.env.BUSABASE_API_KEY });
 * const bases = await client.bases.list();
 * const record = await client.records.get({ recordId });
 * ```
 */
export function createBusabaseClient(config: BusabaseConfig = {}): BusabaseClient {
  const resolved = resolveConfig(config);
  const link = new OpenAPILink(cloudContract, {
    url: resolved.baseUrl,
    fetch: resolved.fetch,
    customErrorResponseBodyDecoder: decodeBusabaseError,
    headers: async () => {
      const extra =
        typeof resolved.headers === "function" ? await resolved.headers() : resolved.headers;
      return {
        ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
        ...(resolved.spaceId ? { "x-busabase-space": resolved.spaceId } : {}),
        ...extra,
      };
    },
  });
  return createORPCClient(link);
}

/** Options for {@link createBusabaseRpcClient}. No `apiKey`/`spaceId` — this
 * transport authenticates purely via the browser's ambient session cookie. */
export interface BusabaseRpcConfig {
  /**
   * Path to the internal RPC endpoint: either a full URL, or a path resolved
   * against `window.location.origin` (browser only — there is no ambient
   * session outside one).
   *
   * **The default (`/api/rpc`) only matches `apps/busabase` (the OSS app)**,
   * which mounts busabase's procedures unnamespaced. `apps/busabase-cloud`
   * mounts the *same* procedures under a `core` prefix instead — pass
   * `apiBasePath: "/api/rpc/core"` there, or this client will 404 on every
   * call. There is no single default that works for both; which one you're
   * targeting is something the caller has to know (this SDK doesn't probe
   * for it).
   *
   * From inside an AirApp running via Nodepod, prepend
   * `/__busabase_api__` to whichever of the above applies, to route through
   * the service-worker bridge instead of the sandboxed virtual server — e.g.
   * `/__busabase_api__/api/rpc/core` for busabase-cloud. See
   * apps/busabase/docs/node-types.md.
   */
  apiBasePath?: string;
  /** Extra headers merged into every request. Static object or a (possibly async) factory. */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Custom `fetch` implementation (e.g. a proxy-aware or instrumented fetch). */
  fetch?: typeof fetch;
}

/**
 * Build a fully-typed Busabase client over the internal RPC transport
 * (`/api/rpc`, the same one the Busabase dashboard's own frontend uses) —
 * authenticated by the current browser session's cookie, not an API key.
 * Use {@link createBusabaseClient} instead for server/CLI code holding an
 * explicit API key against the public `/api/v1` REST surface; this one is for
 * browser-context code (e.g. an AirApp) that should act as the logged-in user
 * viewing it.
 *
 * @example
 * ```ts
 * // Inside an AirApp running via Nodepod, on busabase-cloud (see apiBasePath
 * // above — apps/busabase, the OSS app, would omit the /core segment):
 * const client = createBusabaseRpcClient({ apiBasePath: "/__busabase_api__/api/rpc/core" });
 * const counts = await client.changeRequests.counts();
 * ```
 */
// Reference `window` through `globalThis` with a locally-declared shape rather
// than the ambient DOM `Window` type: this file is consumed as raw source (not
// just built .d.ts) by workspace packages whose tsconfig has no "dom" lib
// (e.g. packages/busabase-dump, Node-only), where the bare `window` identifier
// doesn't resolve at all — `globalThis` is available under every lib target.
// A function, not a module-level const: must re-read on every call, not just
// once at import time (tests stub it in after import; a real page's `window`
// doesn't change, but capturing it once is needless coupling to import order).
const getBrowserWindow = () => (globalThis as { window?: { location: { origin: string } } }).window;

export function createBusabaseRpcClient(config: BusabaseRpcConfig = {}): BusabaseClient {
  const apiBasePath = config.apiBasePath ?? "/api/rpc";
  const isAbsolute = /^https?:\/\//.test(apiBasePath);
  if (!isAbsolute && typeof getBrowserWindow() === "undefined") {
    throw new Error(
      "createBusabaseRpcClient: apiBasePath must be an absolute URL (http:// or https://) " +
        "outside a browser — this client authenticates via the browser's ambient session " +
        "cookie, which only exists client-side.",
    );
  }
  const link = new RPCLink({
    method: inferRPCMethodFromContractRouter(cloudContract),
    url: () => (isAbsolute ? apiBasePath : `${getBrowserWindow()?.location.origin}${apiBasePath}`),
    fetch: config.fetch,
    headers: async () => {
      const extra = typeof config.headers === "function" ? await config.headers() : config.headers;
      return { ...extra };
    },
  });
  return createORPCClient(link);
}
