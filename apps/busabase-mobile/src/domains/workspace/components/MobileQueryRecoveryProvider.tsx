import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { getMobileQueryRecovery, releaseMobileQueryRecovery } from "../utils/mobile-query-recovery";

export function MobileQueryRecoveryProvider({ children }: { children: ReactNode }) {
  const busabase = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const scopeKey = busabase?.scopeKey;
  const requiresInternet = busabase?.mode !== "self-hosted";
  const recovery = useMemo(
    () => (scopeKey ? getMobileQueryRecovery(queryClient, scopeKey) : null),
    [queryClient, scopeKey],
  );
  const lifecycle = useRef({ scopeKey, active: false });

  useEffect(() => {
    if (!recovery || !scopeKey) return;
    lifecycle.current = { scopeKey, active: true };
    let disposed = false;
    let networkVersion = 0;
    const updateNetwork = (network: {
      isConnected: boolean | null;
      isInternetReachable: boolean | null;
    }) => {
      if (disposed) return;
      const online =
        network.isConnected !== false &&
        (!requiresInternet || network.isInternetReachable !== false);
      onlineManager.setOnline(online);
      recovery.setOnline(online);
    };
    const updateForeground = (state: string) => {
      const foreground = state === "active";
      recovery.setForeground(foreground);
      if (Platform.OS !== "web") focusManager.setFocused(foreground);
      if (foreground) {
        const version = networkVersion;
        void NetInfo.fetch()
          .then((network) => {
            if (networkVersion === version) updateNetwork(network);
          })
          .catch(() => undefined);
      }
    };
    updateForeground(AppState.currentState);
    const appSubscription = AppState.addEventListener("change", updateForeground);
    const stopNetwork = NetInfo.addEventListener((network) => {
      networkVersion++;
      updateNetwork(network);
    });
    return () => {
      disposed = true;
      lifecycle.current.active = false;
      appSubscription.remove();
      stopNetwork();
      queueMicrotask(() => {
        if (!lifecycle.current.active || lifecycle.current.scopeKey !== scopeKey) {
          releaseMobileQueryRecovery(queryClient, scopeKey);
        }
      });
    };
  }, [queryClient, recovery, scopeKey, requiresInternet]);

  return children;
}
