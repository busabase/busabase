import { skipToken, useQuery } from "@tanstack/react-query";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  fetchPendingSnapshot,
  type PendingCountClient,
  type PendingSnapshot,
} from "../utils/pending-count";

const EMPTY: PendingSnapshot = { count: 0, preview: [], capped: false };

/**
 * "How many change requests are waiting on me", for Home and the sidebar badge.
 *
 * One shared hook on purpose: the two surfaces sat on separate copies of the
 * same fetch-a-page-and-count-it mistake, with different page sizes, so they
 * disagreed with each other AND with the truth.
 */
export function usePendingChangeRequests({ enabled = true }: { enabled?: boolean } = {}) {
  const buda = useBusabaseOrpc();

  const query = useQuery({
    queryKey: ["pending-change-requests", buda?.spaceScope ?? "no-connection"],
    queryFn: buda
      ? () => fetchPendingSnapshot(buda.client.changeRequests as unknown as PendingCountClient)
      : skipToken,
    enabled: enabled && !!buda,
  });

  return {
    ...(query.data ?? EMPTY),
    error: query.error,
    isLoaded: query.isSuccess,
    loading: query.isLoading,
    refetch: () => void query.refetch(),
    refreshing: query.isRefetching,
  };
}
