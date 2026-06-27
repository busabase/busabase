import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { type BusabaseContract, busabaseContract } from "../contract/busabase";
import { resolveApiUrl } from "./index";

export type BusabaseORPCClient = ContractRouterClient<BusabaseContract>;

/**
 * Standard oRPC RPC client (POST transport). Unlike `createBusabaseORPCClient`, this
 * does NOT use `inferRPCMethodFromContractRouter`, so reads stay POST and never
 * collide with the server's GET REST matchers (e.g. /skills/:id, /search).
 */
export const createBusabaseORPCClient = (apiBasePath = "/api/rpc"): BusabaseORPCClient => {
  const link = new RPCLink({ url: resolveApiUrl(apiBasePath) });
  return createORPCClient<BusabaseORPCClient>(link);
};

/**
 * TanStack Query utils for the Busabase contract: `orpc.records.list.queryOptions(...)`,
 * `orpc.records.updateChangeRequest.mutationOptions(...)`, `orpc.<proc>.key(...)`, etc.
 */
export const createBusabaseQueryUtils = (apiBasePath = "/api/rpc") =>
  createTanstackQueryUtils(createBusabaseORPCClient(apiBasePath));

export type BusabaseQueryUtils = ReturnType<typeof createBusabaseQueryUtils>;

// `busabaseContract` is re-exported so callers can derive keys/types without a second import.
export { busabaseContract };
