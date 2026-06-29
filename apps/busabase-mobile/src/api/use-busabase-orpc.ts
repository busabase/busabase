import {
  createBusabaseORPCClient,
  createBusabaseQueryUtils,
} from "busabase-core/api-client/react-query";
import { useMemo } from "react";
import { useConnection } from "~/connection/connection-store";

export function useBusabaseOrpc() {
  const { state } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;
  const serverUrl = connection?.serverUrl ?? null;
  // Demo connections hit the hosted demo server, which only serves data in demo
  // mode (?demo=1) — its regular dataset is empty.
  const demo = connection?.mode === "demo";

  return useMemo(() => {
    if (!serverUrl) return null;
    const rpcUrl = `${serverUrl.replace(/\/+$/, "")}/api/rpc`;
    return {
      client: createBusabaseORPCClient(rpcUrl, { demo }),
      orpc: createBusabaseQueryUtils(rpcUrl, { demo }),
    };
  }, [serverUrl, demo]);
}
