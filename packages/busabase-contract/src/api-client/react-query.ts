import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
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
}

// RPCLink fetch interceptor that appends `?demo=1` to each outgoing request URL.
const demoFetch: NonNullable<ConstructorParameters<typeof RPCLink>[0]["fetch"]> = (
  request,
  init,
) => {
  const url = new URL(request.url);
  url.searchParams.set("demo", "1");
  return globalThis.fetch(new Request(url.toString(), request), init);
};

/**
 * Standard oRPC RPC client (POST transport). Unlike `createBusabaseORPCClient`, this
 * does NOT use `inferRPCMethodFromContractRouter`, so reads stay POST and never
 * collide with the server's GET REST matchers (e.g. /skills/:id, /search).
 */
export const createBusabaseORPCClient = (
  apiBasePath = "/api/rpc",
  opts: BusabaseClientOptions = {},
): BusabaseORPCClient => {
  const link = new RPCLink({
    url: resolveApiUrl(apiBasePath),
    headers: async () =>
      (typeof opts.headers === "function" ? await opts.headers() : opts.headers) ?? {},
    ...(opts.demo ? { fetch: demoFetch } : {}),
  });
  return createORPCClient<BusabaseORPCClient>(link);
};

/**
 * TanStack Query utils for the Busabase contract: `orpc.records.list.queryOptions(...)`,
 * `orpc.records.updateChangeRequest.mutationOptions(...)`, `orpc.<proc>.key(...)`, etc.
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
