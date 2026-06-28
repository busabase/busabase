import { useMemo } from "react";
import { useConnection } from "~/connection/connection-store";
import { createMobileBusabaseClient } from "./busabase-client";

export function useBusabaseClient() {
  const { state } = useConnection();
  const serverUrl = state.status === "connected" ? state.connection.serverUrl : null;

  return useMemo(() => {
    if (!serverUrl) {
      return null;
    }
    return createMobileBusabaseClient(serverUrl);
  }, [serverUrl]);
}
