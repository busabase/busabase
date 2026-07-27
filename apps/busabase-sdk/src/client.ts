import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
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
   * Bearer token. Falls back to `BUSABASE_API_KEY`. Omit it in the two cases
   * where the server authenticates you some other way: a local OSS server
   * (`apps/busabase`) is open, and a *same-origin browser* call (e.g. from an
   * AirApp running inside Busabase) authenticates as the logged-in user via
   * the ambient session cookie.
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
 * This is the *only* client the SDK ships. Browser code (an AirApp) and
 * server/CLI code use the same one — they differ only in where `baseUrl` and
 * the credential come from: an AirApp running inside Busabase passes
 * `baseUrl: window.location.origin` and no key (the ambient session cookie
 * authenticates it), while the same app run locally against a dev server
 * passes that server's URL and, for Busabase Cloud, an API key.
 *
 * @example
 * ```ts
 * // Server / CLI, against Busabase Cloud:
 * const client = createBusabaseClient({ apiKey: process.env.BUSABASE_API_KEY });
 * const bases = await client.bases.list();
 * const record = await client.records.get({ recordId });
 *
 * // Browser (AirApp), same-origin — no key, the session cookie authenticates:
 * const client = createBusabaseClient({ baseUrl: window.location.origin });
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
