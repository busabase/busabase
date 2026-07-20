import {
  createBusabaseORPCClient,
  createBusabaseQueryUtils,
} from "busabase-contract/api-client/react-query";
import { useMemo } from "react";
import { useConnection } from "~/connection/connection-store";

export function useBusabaseOrpc() {
  const { getCloudAuthorizationHeaders, state } = useConnection();
  const connection = state.status === "connected" ? state.connection : null;
  const serverUrl = connection?.serverUrl ?? null;
  const selectedSpaceId = connection?.selectedSpace?.id ?? null;
  // Demo connections hit the hosted demo server, which only serves data in demo
  // mode (?demo=1) — its regular dataset is empty.
  const demo = connection?.mode === "demo";
  const headers = connection?.mode === "cloud" ? getCloudAuthorizationHeaders : undefined;
  const spaceScope =
    connection?.mode === "cloud" ? (selectedSpaceId ?? "default") : connection?.mode;

  return useMemo(() => {
    if (!serverUrl) return null;
    const rpcPath = connection?.mode === "cloud" ? "/api/rpc/core" : "/api/rpc";
    const rpcUrl = `${serverUrl.replace(/\/+$/, "")}${rpcPath}`;
    return {
      client: createBusabaseORPCClient(rpcUrl, { demo, headers }),
      orpc: createBusabaseQueryUtils(rpcUrl, { demo, headers }),
      serverUrl,
      spaceScope,
      userId: connection?.cloudUser?.id ?? null,
    };
  }, [serverUrl, connection?.mode, connection?.cloudUser?.id, demo, headers, spaceScope]);
}
