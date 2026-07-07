import { createORPCClient } from "@orpc/client";
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
