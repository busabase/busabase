// Pure display helpers for workflow runs on the phone. No react-native, so they
// run under the node Vitest runner.
import type { WorkflowRun, WorkflowRunStatus } from "busabase-contract/domains/workflow/run";

/** How a run's status reads at a glance: the colour of its dot. */
export type WorkflowRunTone = "active" | "attention" | "success" | "failure" | "muted";

export const workflowRunTone = (status: WorkflowRunStatus): WorkflowRunTone => {
  if (status === "queued" || status === "running") return "active";
  if (status === "waiting" || status === "waiting_approval") return "attention";
  if (status === "completed") return "success";
  if (status === "failed") return "failure";
  return "muted";
};

/** The name to show for whoever started the run; an id the server did not name shows as itself. */
export const workflowRunStarterName = (
  run: Pick<WorkflowRun, "startedBy">,
  actorNames: Readonly<Record<string, string>>,
): string => actorNames[run.startedBy] ?? run.startedBy;

/**
 * A step's captured values as text for a phone screen. A step can hold a whole
 * HTTP response, so the text is cut where it stops being useful and says so.
 */
export const clipStepJson = (value: unknown, max = 1500): string => {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
};

/** Whether a run can still be decided by this person: it waits on an approval and they may decide it. */
export const canDecideRun = (
  run: Pick<WorkflowRun, "id" | "status" | "pause">,
  decidableRunIds: readonly string[],
): boolean =>
  run.status === "waiting_approval" &&
  run.pause?.kind === "approval" &&
  decidableRunIds.includes(run.id);
