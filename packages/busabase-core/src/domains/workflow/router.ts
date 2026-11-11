import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  cancelQueuedStoredWorkflowRuns,
  cancelStoredWorkflowRun,
  decideStoredWorkflowRun,
  getStoredWorkflowRun,
  listStoredWorkflowRuns,
  listWaitingStoredWorkflowRuns,
  resumeElapsedStoredWorkflowRuns,
  resumeStoredWorkflowRun,
  retryStoredWorkflowRun,
  startStoredWorkflowRun,
} from "./logic/run-service";

const os = implement(busabaseContract);

export const workflowRouter = {
  start: os.workflows.start.handler(({ input }) => startStoredWorkflowRun(input)),
  get: os.workflows.get.handler(({ input }) => getStoredWorkflowRun(input.runId)),
  list: os.workflows.list.handler(({ input }) => listStoredWorkflowRuns(input)),
  waiting: os.workflows.waiting.handler(({ input }) => listWaitingStoredWorkflowRuns(input)),
  resume: os.workflows.resume.handler(({ input }) => resumeStoredWorkflowRun(input)),
  decide: os.workflows.decide.handler(({ input }) => decideStoredWorkflowRun(input)),
  cancel: os.workflows.cancel.handler(({ input }) => cancelStoredWorkflowRun(input)),
  retry: os.workflows.retry.handler(({ input }) => retryStoredWorkflowRun(input)),
  cancelQueued: os.workflows.cancelQueued.handler(({ input }) =>
    cancelQueuedStoredWorkflowRuns(input),
  ),
  resumeElapsed: os.workflows.resumeElapsed.handler(() => resumeElapsedStoredWorkflowRuns()),
};
