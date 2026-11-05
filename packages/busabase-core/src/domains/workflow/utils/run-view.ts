// Pure view helpers for the workflow Runs panel. Isomorphic: no React, no db.
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepOutput,
} from "busabase-contract/domains/workflow/run";

/** How a step looks in the selected run, for the canvas highlight. */
export type WorkflowRunStepState = "done" | "paused" | "failed";

/** Poll fast while the server is still working on a run. */
export const WORKFLOW_RUN_ACTIVE_POLL_MS = 2_000;
/** Poll slower while a run sits on a Wait or an approval. */
export const WORKFLOW_RUN_PAUSED_POLL_MS = 5_000;

export const isWorkflowRunActive = (status: WorkflowRunStatus) =>
  status === "queued" || status === "running";

export const isWorkflowRunPaused = (status: WorkflowRunStatus) =>
  status === "waiting" || status === "waiting_approval";

/** `refetchInterval` for the run list: fast while running, slower while paused, else off. */
export const workflowRunsPollInterval = (
  runs: readonly Pick<WorkflowRun, "status">[] | undefined,
): number | false => {
  if (!runs?.length) return false;
  if (runs.some((run) => isWorkflowRunActive(run.status))) return WORKFLOW_RUN_ACTIVE_POLL_MS;
  if (runs.some((run) => isWorkflowRunPaused(run.status))) return WORKFLOW_RUN_PAUSED_POLL_MS;
  return false;
};

export type WorkflowRunStatusLabelKey =
  | "statusQueued"
  | "statusRunning"
  | "statusWaiting"
  | "statusWaitingApproval"
  | "statusCompleted"
  | "statusFailed"
  | "statusCancelled";

const STATUS_LABEL_KEY: Record<WorkflowRunStatus, WorkflowRunStatusLabelKey> = {
  queued: "statusQueued",
  running: "statusRunning",
  waiting: "statusWaiting",
  waiting_approval: "statusWaitingApproval",
  completed: "statusCompleted",
  failed: "statusFailed",
  cancelled: "statusCancelled",
};

/** How a formula refers to a step: a dot for a plain name, brackets for anything else. */
export const workflowStepReference = (stepId: string): string =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(stepId) ? `steps.${stepId}` : `steps[${JSON.stringify(stepId)}]`;

/** Whether someone may still stop this run (it is not finished and not mid-step). */
export const isWorkflowRunCancellable = (status: WorkflowRunStatus) =>
  status === "queued" || isWorkflowRunPaused(status);

/** Later pages after the first; the first page wins for a run in both. */
export const mergeWorkflowRunPages = (
  first: readonly WorkflowRun[],
  ...rest: readonly (readonly WorkflowRun[])[]
): WorkflowRun[] => {
  const seen = new Set<string>();
  return [first, ...rest].flat().filter((run) => {
    if (seen.has(run.id)) return false;
    seen.add(run.id);
    return true;
  });
};

/**
 * What a notification link asks for, from its fragment: `#approval-<runId>` and
 * `#failed-<runId>` open that run in the Runs tab, a bare `#approval` or
 * `#failed` (several runs coalesced into one alert) opens the tab. Anything else
 * is not for this panel.
 */
export const parseWorkflowRunLink = (hash: string): { openRuns: boolean; runId: string | null } => {
  const match = /^#(?:approval|failed)(?:-(.+))?$/.exec(hash);
  if (!match) return { openRuns: false, runId: null };
  return { openRuns: true, runId: match[1] ? decodeURIComponent(match[1]) : null };
};

/** Catalog key (under `workflowRuns`) for a run status. */
export const workflowRunStatusLabelKey = (status: WorkflowRunStatus): WorkflowRunStatusLabelKey =>
  STATUS_LABEL_KEY[status];

export interface WorkflowRunStep {
  id: string;
  output: WorkflowStepOutput;
}

const timeOf = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

/** Finished steps in execution order (by `capturedAt`; ties keep the server's order). */
export const orderedWorkflowRunSteps = (outputs: WorkflowRun["outputs"]): WorkflowRunStep[] =>
  Object.entries(outputs)
    .map(([id, output], index) => ({ id, output, index }))
    // Execution order first; runs stored before `sequence` existed fall back to time.
    .sort(
      (a, b) =>
        (a.output.sequence ?? Number.MAX_SAFE_INTEGER) -
          (b.output.sequence ?? Number.MAX_SAFE_INTEGER) ||
        timeOf(a.output.capturedAt) - timeOf(b.output.capturedAt) ||
        a.index - b.index,
    )
    .map(({ id, output }) => ({ id, output }));

/**
 * Per-step state of one run, for highlighting the canvas: every finished step
 * is `done`, the step a Wait/approval is parked on is `paused`, and the step a
 * failed run stopped at is `failed`.
 */
export const workflowRunStepStates = (
  run: Pick<WorkflowRun, "cursorNodeId" | "outputs" | "pause" | "status"> | null | undefined,
): ReadonlyMap<string, WorkflowRunStepState> => {
  const states = new Map<string, WorkflowRunStepState>();
  if (!run) return states;
  for (const id of Object.keys(run.outputs)) states.set(id, "done");
  if (run.pause && isWorkflowRunPaused(run.status)) states.set(run.pause.nodeId, "paused");
  if (run.status === "failed" && run.cursorNodeId) states.set(run.cursorNodeId, "failed");
  return states;
};

export type ParsedWorkflowRunPayload =
  | { ok: true; payload: Record<string, unknown> | undefined }
  | { ok: false };

/** Empty text means "no payload"; anything else must be a JSON object. */
export const parseWorkflowRunPayload = (text: string): ParsedWorkflowRunPayload => {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, payload: undefined };
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return { ok: true, payload: value as Record<string, unknown> };
    }
  } catch {
    // Fall through: not JSON.
  }
  return { ok: false };
};

/** Put a run returned by a mutation into a newest-first list, replacing any older copy. */
export const upsertWorkflowRun = (runs: readonly WorkflowRun[], run: WorkflowRun): WorkflowRun[] =>
  [run, ...runs.filter((entry) => entry.id !== run.id)].sort(
    (a, b) => timeOf(b.startedAt) - timeOf(a.startedAt),
  );

/** The step's name on the workflow, or its id when the step is gone from the graph. */
export const workflowRunStepLabel = (
  stepId: string,
  steps: readonly { id: string; label: string }[],
): string => steps.find((step) => step.id === stepId)?.label.trim() || stepId;

/** Compact pretty JSON for a step's captured values. */
export const formatWorkflowRunJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};
