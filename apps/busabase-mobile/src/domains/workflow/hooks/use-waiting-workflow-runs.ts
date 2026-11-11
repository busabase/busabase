import { useQuery } from "@tanstack/react-query";
import type { WaitingWorkflowRun } from "busabase-contract/domains/workflow/run";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";

export const WAITING_WORKFLOW_RUNS_KEY = "workflow-waiting";

/** The server's cap on one answer; a person with more than this waiting sees the newest. */
const PAGE_SIZE = 100;

/**
 * Runs across every workflow that wait for this person's decision, newest first.
 *
 * Shared by the Approvals tab and its badge: one query, so the number on the
 * tab and the rows under it come from the same answer and cannot drift.
 */
function useWaitingQuery({ enabled }: { enabled: boolean }) {
  const buda = useBusabaseOrpc();
  const queryKey = [buda?.scopeKey ?? "no-connection", WAITING_WORKFLOW_RUNS_KEY];
  useMobileQueryRecovery(enabled && buda ? [queryKey] : []);

  return useQuery({
    queryKey,
    enabled: enabled && !!buda,
    queryFn: () => {
      if (!buda) throw new Error("Not connected");
      return buda.client.workflows.waiting({ limit: PAGE_SIZE });
    },
    // A run only waits on a person, and a person decides on another device or
    // in the web app: look again now and then while the list is on screen. Not
    // after a failure: a server too old to know this call would otherwise be
    // asked again every few seconds, for an answer it can never give.
    refetchInterval: (query) => (query.state.status === "error" ? false : 15_000),
  });
}

/** The Approvals tab's rows. */
export function useWaitingWorkflowRuns({ enabled }: { enabled: boolean }) {
  const query = useWaitingQuery({ enabled });
  const items: WaitingWorkflowRun[] = query.data?.items ?? [];

  return {
    items,
    actorNames: query.data?.actorNames ?? {},
    error: query.error,
    loading: query.isLoading,
    refreshing: query.isRefetching,
    hasMore: false,
    loadingMore: false,
    loadMore: () => undefined,
    refetch: () => void query.refetch(),
  };
}

/**
 * The count on the Approvals tab, fetched while another tab is on screen.
 *
 * Like the unread-mention badge, this is a notification, not a summary of the
 * tab being viewed: someone waiting on a decision has to reach the person
 * without them going looking for it.
 */
export function useWaitingWorkflowRunCount() {
  return useWaitingQuery({ enabled: true }).data?.items.length ?? 0;
}
