import { skipToken, useQuery } from "@tanstack/react-query";
import { workflowRunsPollInterval } from "busabase-core/dashboard/workflow-run-view";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";

/**
 * The latest runs of one workflow, newest first.
 *
 * Polls while the server is still working on a run or one sits on a Wait or an
 * approval, and stops once every run is finished — the same cadence the web
 * Runs panel uses, so the two never disagree about what is happening.
 */
export function useWorkflowRuns(nodeId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const buda = useBusabaseOrpc();
  const options =
    buda && nodeId && enabled ? buda.orpc.workflows.list.queryOptions({ input: { nodeId } }) : null;
  useMobileQueryRecovery(options ? [options.queryKey] : []);

  return useQuery({
    ...(options ?? { queryKey: ["no-connection", "workflow-runs", nodeId], queryFn: skipToken }),
    refetchInterval: (query) => workflowRunsPollInterval(query.state.data?.runs),
  });
}
