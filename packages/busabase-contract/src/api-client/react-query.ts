import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { type BusabaseContract, busabaseContract } from "../contract/busabase";
import { resolveApiUrl } from "./index";

export type BusabaseORPCClient = ContractRouterClient<BusabaseContract>;

export interface BusabaseClientOptions {
  /**
   * Connect in demo mode: append `?demo=1` to every request so the server serves
   * the seeded demo dataset. The `?demo` query param is the reliable signal — a
   * hosted demo's CDN may strip custom request headers like `x-demo-mode`.
   */
  demo?: boolean;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Optional transport override for host-specific response handling. */
  fetch?: NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]>;
}

// RPCLink fetch interceptor that appends `?demo=1` to each outgoing request URL.
const createDemoFetch =
  (
    fetchImpl: NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]>,
  ): NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]> =>
  (request, init, path, input, options) => {
    const url = new URL(request.url);
    url.searchParams.set("demo", "1");
    return fetchImpl(new Request(url.toString(), request), init, path, input, options);
  };

/**
 * Procedures that must NEVER be folded into a batch request.
 *
 * `live.subscribe` is an Event Iterator — a long-lived SSE stream. A batch is
 * one HTTP request that completes when all its members complete, so batching a
 * stream would hold the whole batch open for the lifetime of the subscription
 * and stall every sibling call in it.
 */
const UNBATCHABLE_PROCEDURES = new Set(["live.subscribe"]);

const isBatchable = (path: readonly string[]): boolean =>
  !UNBATCHABLE_PROCEDURES.has(path.join("."));

/**
 * Collapse the burst of parallel queries a dashboard route fires into a single
 * `/api/rpc/__batch__` round trip.
 *
 * This is not just about saving round trips. Every separate HTTP request
 * independently re-resolves the session (`auth.api.getSession`) and the space
 * ACL before reaching its procedure, and on a single-connection database those
 * repeated lookups serialise. Measured on the cloud inbox, which fired ~15
 * unbatched calls: the per-request auth phase climbed 17ms → 74ms across the
 * burst while every actual query stayed at 1–10ms, and the last response landed
 * ~800ms after the first. One batched request pays that boundary cost once.
 *
 * The server side already accepts this: `/api/rpc` mounts `BatchHandlerPlugin`,
 * which splits the batch back into individual calls — each still running its own
 * per-procedure auth middleware, so batching grants no authority a separate call
 * would not have had.
 */
const batchPlugin = () =>
  new BatchLinkPlugin({
    groups: [{ condition: ({ path }) => isBatchable(path), context: {} }],
  });

/**
 * Standard oRPC RPC client (POST transport). Unlike `createBusabaseORPCClient`, this
 * does NOT use `inferRPCMethodFromContractRouter`, so reads stay POST and never
 * collide with the server's GET REST matchers (e.g. /file-trees/:id, /search).
 */
export const createBusabaseORPCClient = (
  apiBasePath = "/api/rpc",
  opts: BusabaseClientOptions = {},
): BusabaseORPCClient => {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const link = new RPCLink({
    url: resolveApiUrl(apiBasePath),
    headers: async () =>
      (typeof opts.headers === "function" ? await opts.headers() : opts.headers) ?? {},
    ...(opts.demo
      ? { fetch: createDemoFetch(fetchImpl) }
      : opts.fetch
        ? { fetch: opts.fetch }
        : {}),
    plugins: [batchPlugin()],
  });
  return createORPCClient<BusabaseORPCClient>(link);
};

/**
 * TanStack Query utils for the Busabase contract: `orpc.records.list.queryOptions(...)`,
 * `orpc.records.changeRequest.mutationOptions(...)`, `orpc.<proc>.key(...)`, etc.
 *
 * `keyPrefix` prepends a segment to EVERY generated query/mutation key. The cloud
 * passes the active space id so one space's cached reads can never be served under
 * another (per-space cache isolation) — every query, `listKeys` entry and `.key()`
 * built from these utils is namespaced in one place. Open source leaves it default.
 */
export const createBusabaseQueryUtils = (
  apiBasePath = "/api/rpc",
  opts: BusabaseClientOptions = {},
  keyPrefix?: string,
) =>
  createTanstackQueryUtils(
    createBusabaseORPCClient(apiBasePath, opts),
    keyPrefix ? { path: [keyPrefix] } : undefined,
  );

export type BusabaseQueryUtils = ReturnType<typeof createBusabaseQueryUtils>;

// `busabaseContract` is re-exported so callers can derive keys/types without a second import.
export { busabaseContract };
