import type { ContractRouterClient } from "@orpc/contract";
import { type CloudContract } from "busabase-contract/contract/cloud";
import { normalizeBaseUrl } from "./url.js";
export { normalizeBaseUrl };
/**
 * The fully-typed Busabase client. Built over the *cloud* contract, which is a
 * strict superset of the OSS workbench contract (it adds the cloud-only `/api/v1`
 * endpoints: `system`, `users`, `agentTasks`). This keeps every OSS workbench
 * command working against a local server while unlocking the cloud endpoints when
 * pointed at busabase.com with an API key.
 *
 * Namespaced by domain — e.g. `client.bases.list()`, `client.records.get({ recordId })`,
 * `client.changeRequests.merge({ changeRequestIds })`, `client.system.health()`.
 */
export type BusabaseClient = ContractRouterClient<CloudContract>;
/**
 * Default host when neither an explicit `baseUrl` nor `BUSABASE_BASE_URL` is set:
 * the always-on Busabase Cloud. A local server default would just refuse the
 * connection unless the desktop/OSS app is running, so a cold client reaches a
 * real server this way. For a local server, pass `baseUrl: "http://localhost:15419"`
 * (or export `BUSABASE_BASE_URL`).
 */
export declare const DEFAULT_BASE_URL = "https://busabase.com";
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
   * Origin the *web app* is served from, for building human-openable links (see
   * {@link Busabase.nodeUrl}). Falls back to `BUSABASE_WEB_URL`, then to
   * `baseUrl`.
   *
   * That fallback is why this field exists rather than being assumed: on Cloud
   * and on a local OSS server the API and the dashboard happen to be
   * same-origin, so `baseUrl` is right almost always — but "almost always" was
   * silently baked into every caller that hand-built a link. Behind a gateway
   * that mounts the API on its own host, or on a workspace subdomain, they
   * diverge and only the caller knows.
   */
  webUrl?: string;
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
  webUrl: string;
  apiKey?: string;
  spaceId?: string;
  headers?: BusabaseConfig["headers"];
  fetch?: typeof fetch;
}
/** Fill in missing config fields from environment variables and defaults. */
export declare function resolveConfig(config?: BusabaseConfig): ResolvedConfig;
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
export declare function createBusabaseClient(config?: BusabaseConfig): BusabaseClient;
