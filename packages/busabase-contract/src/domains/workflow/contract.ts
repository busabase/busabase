import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  CancelQueuedWorkflowRunsInputSchema,
  CancelQueuedWorkflowRunsOutputSchema,
  CancelWorkflowRunInputSchema,
  DecideWorkflowRunInputSchema,
  GetWorkflowRunInputSchema,
  ListWaitingWorkflowRunsInputSchema,
  ListWaitingWorkflowRunsOutputSchema,
  ListWorkflowRunsInputSchema,
  ListWorkflowRunsOutputSchema,
  ResumeElapsedWorkflowRunsOutputSchema,
  ResumeWorkflowRunInputSchema,
  RetryWorkflowRunInputSchema,
  StartWorkflowRunInputSchema,
  WorkflowRunSchema,
} from "./run";

/**
 * Workflow runs. Six procedures are public (`/api/v1`, MCP, CLI) so agents can
 * see, start, retry, cancel, and, where a step allows it, decide runs. The rest stay
 * RPC-only for the app: hosts drop them from the public router, because a
 * path-less procedure would otherwise be served at an inferred path.
 *
 * Freshness is mixed. See `WORKFLOW_DATA_FRESHNESS` in `./run`.
 */
export const workflowRuntimeContract = {
  start: oc
    .route({
      method: "POST",
      path: "/workflows/{nodeId}/runs",
      tags: ["Workflows"],
      summary: "Start a workflow run",
      successDescription:
        "The run as it stands after its first steps: completed, failed, or paused on a Wait or an approval. Needs write on the workflow, with a write-level key. It keeps acting as the key's owner, capped by the key.",
    })
    .input(StartWorkflowRunInputSchema)
    .output(WorkflowRunSchema),
  get: oc
    .route({
      method: "GET",
      path: "/workflow-runs/{runId}",
      tags: ["Workflows"],
      summary: "Get a workflow run",
      successDescription: "One run, with every finished step's snapshot.",
    })
    .input(GetWorkflowRunInputSchema)
    .output(WorkflowRunSchema),
  list: oc
    .route({
      method: "GET",
      path: "/workflows/{nodeId}/runs",
      tags: ["Workflows"],
      summary: "List workflow runs",
      successDescription:
        "A page of runs, newest first, with `nextCursor`, the runs the caller may decide, and how many are queued.",
    })
    .input(ListWorkflowRunsInputSchema)
    .output(ListWorkflowRunsOutputSchema),
  // App-only (no route): the phone's "waiting for me" list, across workflows.
  waiting: oc.input(ListWaitingWorkflowRunsInputSchema).output(ListWaitingWorkflowRunsOutputSchema),
  resume: oc.input(ResumeWorkflowRunInputSchema).output(WorkflowRunSchema),
  decide: oc
    .route({
      method: "POST",
      path: "/workflow-runs/{runId}/decide",
      tags: ["Workflows"],
      summary: "Approve or reject a paused workflow run",
      successDescription:
        "The run after the decision. An agent may decide only a step with `allowAgents` on, with a write-level key, and only if the key's owner meets the step's approver rule. Otherwise 403: the decision belongs to a person.",
    })
    .input(DecideWorkflowRunInputSchema)
    .output(WorkflowRunSchema),
  cancel: oc
    .route({
      method: "POST",
      path: "/workflow-runs/{runId}/cancel",
      tags: ["Workflows"],
      summary: "Cancel a workflow run",
      successDescription:
        "The cancelled run. A run executing a step answers 409, because a step already sent cannot be taken back.",
    })
    .input(CancelWorkflowRunInputSchema)
    .output(WorkflowRunSchema),
  retry: oc
    .route({
      method: "POST",
      path: "/workflow-runs/{runId}/retry",
      tags: ["Workflows"],
      summary: "Retry a failed workflow run from the step it stopped at",
      successDescription:
        "A new run that carries the failed run's earlier steps unchanged and runs again from the step that failed, with that step's current settings. The step runs again, so a request it already sent is sent again. Needs write on the workflow, with a write-level key; 400 when the run did not fail or stopped on a step that is gone, 409 when it was already retried. The failed run is left as it was and says which run retried it.",
    })
    .input(RetryWorkflowRunInputSchema)
    .output(WorkflowRunSchema),
  cancelQueued: oc
    .input(CancelQueuedWorkflowRunsInputSchema)
    .output(CancelQueuedWorkflowRunsOutputSchema),
  resumeElapsed: oc.input(z.object({}).strict()).output(ResumeElapsedWorkflowRunsOutputSchema),
};
