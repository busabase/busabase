import { hashKey, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { getMobileQueryRecovery } from "../utils/mobile-query-recovery";

const noSubscription = () => () => undefined;
const alwaysAvailable = () => true;

export function useMobileQueryRecovery(queryKeys: readonly QueryKey[]): boolean {
  const busabase = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const scopeKey = busabase?.scopeKey;
  const recovery = useMemo(
    () => (scopeKey ? getMobileQueryRecovery(queryClient, scopeKey) : null),
    [queryClient, scopeKey],
  );
  const token = useRef(Symbol("mobile-query-route"));
  const keys = useRef(queryKeys);
  keys.current = queryKeys;
  const focused = useRef(false);
  const [routeFocused, setRouteFocused] = useState(false);
  const visitedScope = useRef<string | undefined>(undefined);
  const keyHash = hashKey(queryKeys);

  useFocusEffect(
    useCallback(() => {
      if (!recovery) return;
      focused.current = true;
      setRouteFocused(true);
      recovery.registerRoute(token.current, keys.current);
      if (visitedScope.current === scopeKey) recovery.reconcile();
      visitedScope.current = scopeKey;
      return () => {
        focused.current = false;
        setRouteFocused(false);
        recovery.unregisterRoute(token.current);
      };
    }, [recovery, scopeKey]),
  );

  useEffect(() => {
    if (focused.current) recovery?.registerRoute(token.current, JSON.parse(keyHash) as QueryKey[]);
  }, [recovery, keyHash]);
  const available = useSyncExternalStore(
    recovery?.subscribe ?? noSubscription,
    recovery?.isAvailable ?? alwaysAvailable,
    alwaysAvailable,
  );
  return routeFocused && available;
}
