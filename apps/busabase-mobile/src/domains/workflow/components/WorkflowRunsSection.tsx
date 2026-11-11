import { workflowRunStatusLabelKey } from "busabase-core/dashboard/workflow-run-view";
import { useRouter } from "expo-router";
import { NativeRow, NativeSection } from "~/components/native-list";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useI18n } from "~/i18n";
import { formatDate } from "~/lib/format";
import { useWorkflowRuns } from "../hooks/use-workflow-runs";
import { workflowRunStarterName } from "../utils/run-display";
import { RunStatusDot } from "./RunStatusDot";

interface WorkflowRunsSectionProps {
  nodeId: string;
  /** The workflow's steps, to name the one a run is waiting on. */
  steps: readonly { id: string; label: string }[];
}

/** The Runs tab of a workflow: what has run, newest first, and where each run stands. */
export function WorkflowRunsSection({ nodeId, steps }: WorkflowRunsSectionProps) {
  const { t } = useI18n();
  const router = useRouter();
  const runsQuery = useWorkflowRuns(nodeId);
  const runs = runsQuery.data?.runs ?? [];
  const actorNames = runsQuery.data?.actorNames ?? {};

  if (runsQuery.isLoading) return <NativeLoadingState label={t.workflow.loadingRuns} />;
  if (runsQuery.error) {
    return (
      <NativeErrorState
        message={runsQuery.error.message}
        onRetry={() => void runsQuery.refetch()}
      />
    );
  }
  if (runs.length === 0) {
    return <NativeEmptyState title={t.workflow.noRuns} description={t.workflow.noRunsBody} />;
  }

  return (
    <NativeSection title={t.workflow.runs} caption={`${runs.length}`}>
      {runs.map((run, index) => {
        const waitingStep =
          run.status === "waiting_approval" && run.pause
            ? (steps.find((step) => step.id === run.pause?.nodeId)?.label ?? run.pause.nodeId)
            : null;
        return (
          <NativeRow
            key={run.id}
            title={t.workflow[workflowRunStatusLabelKey(run.status)]}
            subtitle={waitingStep ?? workflowRunStarterName(run, actorNames)}
            meta={formatDate(run.startedAt)}
            leading={<RunStatusDot status={run.status} />}
            last={index === runs.length - 1}
            onPress={() =>
              router.push({
                pathname: "/workflow/[nodeId]/runs/[runId]",
                params: { nodeId, runId: run.id },
              })
            }
          />
        );
      })}
    </NativeSection>
  );
}
