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
    const browserNetwork =
      Platform.OS === "web" && typeof window !== "undefined" && typeof navigator !== "undefined";
    let latestNetwork: { isConnected: boolean | null; isInternetReachable: boolean | null } = {
      isConnected: null,
      isInternetReachable: null,
    };
    const updateNetwork = (network: {
      isConnected: boolean | null;
      isInternetReachable: boolean | null;
    }) => {
      if (disposed) return;
      latestNetwork = network;
      const online =
        (!browserNetwork || navigator.onLine) &&
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
    // NetInfo's web adapter listens only to navigator.connection.change when
    // that optional API exists. Chromium can emit window online/offline
    // without changing that connection object, so also observe the standard
    // events. Keep an explicit failed Cloud reachability probe authoritative.
    const updateBrowserNetwork = () => {
      if (disposed) return;
      const version = ++networkVersion;
      updateNetwork(latestNetwork);
      if (navigator.onLine) {
        // fetch() may return NetInfo's cached offline state. refresh() asks
        // its adapter again and retains its internet reachability policy.
        void NetInfo.refresh()
          .then((network) => {
            if (networkVersion === version) updateNetwork(network);
          })
          .catch(() => undefined);
      }
    };
    if (browserNetwork) {
      window.addEventListener("online", updateBrowserNetwork);
      window.addEventListener("offline", updateBrowserNetwork);
    }
    updateForeground(AppState.currentState);
    const appSubscription = AppState.addEventListener("change", updateForeground);
    const stopNetwork = NetInfo.addEventListener((network) => {
      networkVersion++;
      updateNetwork(network);
    });
    return () => {
      disposed = true;
      if (browserNetwork) {
        window.removeEventListener("online", updateBrowserNetwork);
        window.removeEventListener("offline", updateBrowserNetwork);
      }
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
