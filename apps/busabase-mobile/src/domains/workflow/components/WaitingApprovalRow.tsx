import type { WaitingWorkflowRun } from "busabase-contract/domains/workflow/run";
import { NativeRow } from "~/components/native-list";
import { fmt, useI18n } from "~/i18n";
import { formatListTime } from "~/lib/format";
import { workflowRunStarterName } from "../utils/run-display";
import { RunStatusDot } from "./RunStatusDot";

interface WaitingApprovalRowProps {
  item: WaitingWorkflowRun;
  actorNames: Readonly<Record<string, string>>;
  last?: boolean;
  onPress: () => void;
}

/** One run waiting for this person: the workflow it belongs to, the step, and who started it. */
export function WaitingApprovalRow({ item, actorNames, last, onPress }: WaitingApprovalRowProps) {
  const { t } = useI18n();
  return (
    <NativeRow
      title={item.workflowName}
      subtitle={fmt(t.workflow.approvalsWaitingOn, {
        step: item.stepLabel,
        name: workflowRunStarterName(item.run, actorNames),
      })}
      meta={formatListTime(item.run.updatedAt)}
      leading={<RunStatusDot status={item.run.status} />}
      last={last}
      onPress={onPress}
    />
  );
}
