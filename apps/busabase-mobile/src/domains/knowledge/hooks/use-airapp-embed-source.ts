import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { getValidBusabaseCloudSession } from "~/auth/oauth";
import { getCloudSessionToken } from "~/auth/session-store";
import {
  type AirAppEmbedSource,
  buildAirAppEmbedSource,
} from "~/domains/knowledge/utils/airapp-embed-url";

interface AirAppConnection {
  serverUrl: string;
  mode: "self-hosted" | "demo" | "cloud";
}

interface UseAirAppEmbedSourceOptions {
  connection: AirAppConnection | null;
  spaceId: string | null;
  nodeId: string;
}

interface AirAppEmbedSourceState {
  source: AirAppEmbedSource | null;
  isPreparing: boolean;
  retry: () => void;
}

export const useAirAppEmbedSource = ({
  connection,
  spaceId,
  nodeId,
}: UseAirAppEmbedSourceOptions): AirAppEmbedSourceState => {
  const [source, setSource] = useState<AirAppEmbedSource | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void retryToken;
      let active = true;
      setSource(null);

      const ready = Boolean(connection && nodeId && (connection.mode !== "cloud" || spaceId));
      if (!ready || !connection) {
        setIsPreparing(false);
        return () => {
          active = false;
        };
      }

      setIsPreparing(true);
      void (async () => {
        const bearerToken =
          connection.mode === "cloud"
            ? getCloudSessionToken(await getValidBusabaseCloudSession())
            : null;
        return buildAirAppEmbedSource({
          serverUrl: connection.serverUrl,
          mode: connection.mode,
          bearerToken,
          spaceId,
          nodeId,
        });
      })()
        .then((nextSource) => {
          if (active) {
            setSource(nextSource);
          }
        })
        .catch(() => {
          if (active) setSource(null);
        })
        .finally(() => {
          if (active) setIsPreparing(false);
        });

      return () => {
        active = false;
      };
    }, [connection, nodeId, retryToken, spaceId]),
  );

  return {
    source,
    isPreparing,
    retry: () => setRetryToken((current) => current + 1),
  };
};
