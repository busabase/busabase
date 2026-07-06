"use client";

import { consumeEventIterator } from "@orpc/client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { useEffect, useMemo } from "react";
import type { z } from "zod";

type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

interface UseBusabaseLiveSyncOptions {
  actorId?: string | null;
  activeBaseId?: string | null;
  listKeys: {
    archivedBases: QueryKey;
    archivedNodes: QueryKey;
    auditEvents: QueryKey;
    bases: QueryKey;
    changeRequests: QueryKey;
    nodes: QueryKey;
    records: QueryKey;
  };
  orpc: BusabaseQueryUtils;
  queryClient: QueryClient;
}

export function useBusabaseLiveSync({
  actorId,
  activeBaseId,
  listKeys,
  orpc,
  queryClient,
}: UseBusabaseLiveSyncOptions) {
  const stableListKeys = useMemo(
    () => listKeys,
    [
      listKeys.archivedBases,
      listKeys.archivedNodes,
      listKeys.auditEvents,
      listKeys.bases,
      listKeys.changeRequests,
      listKeys.nodes,
      listKeys.records,
      listKeys,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const invalidateBaseScope = (baseId: string) => {
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listViews.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedViews.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listArchivedRecords.queryOptions({ input: { baseId } }).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.bases.listDeletedFields.queryOptions({ input: { baseId } }).queryKey,
      });
    };

    const invalidateWorkspace = () => {
      void queryClient.invalidateQueries({ queryKey: stableListKeys.nodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedNodes });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.records });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequests });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.auditEvents });
      if (activeBaseId) {
        invalidateBaseScope(activeBaseId);
      }
    };

    const handleEvent = (event: BusabaseLiveEvent) => {
      // Local mutations already invalidate their own queries in mutation handlers.
      // Skipping same-actor live events avoids an immediate duplicate refresh while
      // still letting other collaborators' merged CRs update this tab.
      if (actorId && event.actorId === actorId) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: stableListKeys.changeRequests });
      void queryClient.invalidateQueries({ queryKey: stableListKeys.auditEvents });

      if (event.nodeIds.length > 0) {
        void queryClient.invalidateQueries({ queryKey: stableListKeys.nodes });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedNodes });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
      }

      if (event.recordIds.length > 0 || event.viewIds.length > 0 || event.baseId) {
        void queryClient.invalidateQueries({ queryKey: stableListKeys.records });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.bases });
        void queryClient.invalidateQueries({ queryKey: stableListKeys.archivedBases });
        if (event.baseId) {
          invalidateBaseScope(event.baseId);
        }
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }

      // Redis pub/sub does not retain history. Refresh on every reconnect so a
      // temporarily disconnected tab still converges to the latest workspace state.
      invalidateWorkspace();
      unsubscribe = consumeEventIterator(orpc.live.subscribe.call(undefined), {
        onEvent: handleEvent,
        onError: () => {
          if (!cancelled) {
            retryTimer = setTimeout(connect, 3000);
          }
        },
        onSuccess: () => {
          if (!cancelled) {
            retryTimer = setTimeout(connect, 3000);
          }
        },
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      void unsubscribe?.();
    };
  }, [activeBaseId, actorId, orpc, queryClient, stableListKeys]);
}
