import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DecideWorkflowRunInput } from "busabase-contract/domains/workflow/run";
import { asNodeDetail } from "busabase-core/dashboard/node-detail";
import { workflowRunsPollInterval } from "busabase-core/dashboard/workflow-run-view";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";
import { invalidateMobileWorkspaceQueries } from "~/domains/workspace/utils/mobile-query-recovery";
import { WAITING_WORKFLOW_RUNS_KEY } from "./use-waiting-workflow-runs";

/**
 * One run, with what this person may do to it, plus the workflow's steps so a
 * step can be shown by its name rather than its id.
 *
 * The run comes from `workflows.list` asked for a single run: that is the call
 * that also says whether the caller may decide it (`decidableRunIds`), which
 * `workflows.get` does not.
 */
export function useWorkflowRun(nodeId: string, runId: string) {
  const buda = useBusabaseOrpc();
  const runOptions =
    buda && nodeId && runId
      ? buda.orpc.workflows.list.queryOptions({ input: { nodeId, runId } })
      : null;
  const nodeOptions =
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "workflow" } })
      : null;
  useMobileQueryRecovery([
    ...(runOptions ? [runOptions.queryKey] : []),
    ...(nodeOptions ? [nodeOptions.queryKey] : []),
  ]);

  const runQuery = useQuery({
    ...(runOptions ?? { queryKey: ["no-connection", "workflow-run", runId], queryFn: skipToken }),
    refetchInterval: (query) => workflowRunsPollInterval(query.state.data?.runs),
  });
  const nodeQuery = useQuery(
    nodeOptions ?? { queryKey: ["no-connection", "workflow-node", nodeId], queryFn: skipToken },
  );

  const detail = asNodeDetail(nodeQuery.data, "workflow");
  return {
    run: runQuery.data?.runs.find((candidate) => candidate.id === runId) ?? null,
    decidableRunIds: runQuery.data?.decidableRunIds ?? [],
    actorNames: runQuery.data?.actorNames ?? {},
    workflowName: detail?.node.name ?? "",
    // The graph's steps, only for naming the ones the run reports on.
    steps: detail?.document.nodes ?? [],
    loading: runQuery.isLoading,
    refreshing: runQuery.isRefetching,
    error: runQuery.error,
    refetch: () => {
      void runQuery.refetch();
      void nodeQuery.refetch();
    },
  };
}

/** Approve or reject the approval step a run is waiting on. */
export function useDecideWorkflowRun() {
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DecideWorkflowRunInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.workflows.decide(input);
    },
    // Settled, not just succeeded: when someone else decided first the call fails,
    // and the screen should catch up with the run as it now is, not stay on a
    // button that no longer does anything.
    onSettled: () => {
      if (!buda) return;
      // The run moves on, and it leaves everyone's "waiting for me" list.
      invalidateMobileWorkspaceQueries(queryClient, buda.scopeKey, [
        buda.orpc.workflows.key(),
        [buda.scopeKey, WAITING_WORKFLOW_RUNS_KEY],
      ]);
    },
  });
}
