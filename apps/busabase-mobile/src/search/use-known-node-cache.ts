import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { createKnownNodeCache, createKnownNodeCacheScope } from "./known-node-cache";

const caches = new Map<string, ReturnType<typeof createKnownNodeCache>>();

export const useKnownNodeCache = () => {
  const buda = useBusabaseOrpc();
  const scope = buda
    ? createKnownNodeCacheScope(buda.serverUrl, buda.spaceScope, buda.userId)
    : null;

  return useMemo(() => {
    if (!scope) return null;
    const existing = caches.get(scope);
    if (existing) return existing;
    const cache = createKnownNodeCache(scope, AsyncStorage);
    caches.set(scope, cache);
    return cache;
  }, [scope]);
};
