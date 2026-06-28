import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { type ContractRouterClient, inferRPCMethodFromContractRouter } from "@orpc/contract";
import { type BusabaseContract, busabaseContract } from "busabase-core/contract/busabase";

export function createMobileBusabaseClient(
  serverUrl: string,
): ContractRouterClient<BusabaseContract> {
  const link = new RPCLink({
    method: inferRPCMethodFromContractRouter(busabaseContract),
    url: `${serverUrl.replace(/\/+$/, "")}/api/v1`,
  });

  return createORPCClient(link);
}
