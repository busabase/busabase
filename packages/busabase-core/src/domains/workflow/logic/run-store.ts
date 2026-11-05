import type { WorkflowRun } from "busabase-contract/domains/workflow/run";

/**
 * Where runs live. The walker in `./runs` only talks to this interface:
 * `./run-store-db` keeps them in Postgres for the real server, and the memory
 * store below serves the stateless demo and the unit tests.
 *
 * A run is advanced by exactly one worker at a time. `insert` leaves the new
 * run leased to its creator; anyone else must `claim` it first. The lease
 * expires on its own, so a worker that dies mid-run does not hold it forever.
 */
export interface WorkflowRunPosition {
  startedAt: string;
  id: string;
}

export interface WorkflowRunStore {
  /** Store a new run, leased to the caller until `release`. */
  insert(run: WorkflowRun, leaseUntil: number): Promise<void>;
  /** Overwrite a run the caller holds. Does not release it. */
  save(run: WorkflowRun): Promise<void>;
  get(runId: string): Promise<WorkflowRun | null>;
  /** Newest first. `before` continues after that run (older ones only). */
  listForWorkflow(
    spaceId: string,
    workflowNodeId: string,
    limit: number,
    before?: WorkflowRunPosition,
  ): Promise<WorkflowRun[]>;
  /** Runs of one workflow in one status. */
  countWithStatus(
    spaceId: string,
    workflowNodeId: string,
    status: WorkflowRun["status"],
  ): Promise<number>;
  /**
   * Cancel every queued run of one workflow that no worker holds right now, in
   * one statement. Returns how many stopped.
   */
  cancelQueued(
    spaceId: string,
    workflowNodeId: string,
    cancelledBy: string,
    now: number,
  ): Promise<number>;
  /** Delete up to `limit` finished runs last touched before `before`. Returns how many went. */
  purgeFinished(before: number, limit: number): Promise<number>;
  /** Waits in one space whose time has passed. */
  listElapsedWaits(spaceId: string, now: number): Promise<WorkflowRun[]>;
  /** Across spaces: queued event runs and elapsed Waits, oldest first. */
  listDue(now: number, limit: number): Promise<WorkflowRun[]>;
  /**
   * `running` runs whose lease ran out: the worker that was advancing them is
   * gone. They are failed rather than retried, because a half-run step (a
   * function's outbound call) must not silently run twice.
   */
  listInterrupted(now: number, limit: number): Promise<WorkflowRun[]>;
  /** Take the run for advancing. False when another worker holds a live lease. */
  claim(runId: string, now: number, leaseUntil: number): Promise<boolean>;
  release(runId: string): Promise<void>;
}

/**
 * How long one worker may hold a run. Generous on purpose: a run can chain
 * several function steps, each with up to five minutes of timeout.
 */
export const WORKFLOW_RUN_LEASE_MS = 30 * 60_000;

/** Nothing more happens to a run in one of these. */
export const FINISHED_WORKFLOW_RUN_STATUSES: readonly WorkflowRun["status"][] = [
  "completed",
  "failed",
  "cancelled",
];

const clone = <T>(value: T): T => structuredClone(value);

const isElapsedWait = (run: WorkflowRun, now: number): boolean =>
  run.status === "waiting" &&
  run.pause?.kind === "wait" &&
  run.pause.resumeAt !== null &&
  Date.parse(run.pause.resumeAt) <= now;

/** Process-local runs. Used by the stateless demo and by unit tests. */
export const createMemoryWorkflowRunStore = (): WorkflowRunStore => {
  const runs = new Map<string, WorkflowRun>();
  const leases = new Map<string, number>();
  return {
    async insert(run, leaseUntil) {
      runs.set(run.id, clone(run));
      leases.set(run.id, leaseUntil);
    },
    async save(run) {
      runs.set(run.id, clone(run));
    },
    async get(runId) {
      const run = runs.get(runId);
      return run ? clone(run) : null;
    },
    async listForWorkflow(spaceId, workflowNodeId, limit, before) {
      const position = (run: WorkflowRunPosition) => `${run.startedAt}|${run.id}`;
      return [...runs.values()]
        .filter((run) => run.spaceId === spaceId && run.workflowNodeId === workflowNodeId)
        .filter((run) => !before || position(run) < position(before))
        .sort((a, b) => position(b).localeCompare(position(a)))
        .slice(0, limit)
        .map(clone);
    },
    async countWithStatus(spaceId, workflowNodeId, status) {
      return [...runs.values()].filter(
        (run) =>
          run.spaceId === spaceId && run.workflowNodeId === workflowNodeId && run.status === status,
      ).length;
    },
    async cancelQueued(spaceId, workflowNodeId, cancelledBy, now) {
      let cancelled = 0;
      for (const run of runs.values()) {
        const held = leases.get(run.id);
        if (
          run.spaceId !== spaceId ||
          run.workflowNodeId !== workflowNodeId ||
          run.status !== "queued" ||
          (held !== undefined && held >= now)
        ) {
          continue;
        }
        run.status = "cancelled";
        run.cancelledBy = cancelledBy;
        run.updatedAt = new Date(now).toISOString();
        cancelled += 1;
      }
      return cancelled;
    },
    async purgeFinished(before, limit) {
      const stale = [...runs.values()]
        .filter(
          (run) =>
            FINISHED_WORKFLOW_RUN_STATUSES.includes(run.status) &&
            Date.parse(run.updatedAt) < before,
        )
        .slice(0, limit);
      for (const run of stale) {
        runs.delete(run.id);
        leases.delete(run.id);
      }
      return stale.length;
    },
    async listElapsedWaits(spaceId, now) {
      return [...runs.values()]
        .filter((run) => run.spaceId === spaceId && isElapsedWait(run, now))
        .map(clone);
    },
    async listDue(now, limit) {
      return [...runs.values()]
        .filter((run) => run.status === "queued" || isElapsedWait(run, now))
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, limit)
        .map(clone);
    },
    async listInterrupted(now, limit) {
      return [...runs.values()]
        .filter((run) => {
          const lease = leases.get(run.id);
          return run.status === "running" && (lease === undefined || lease < now);
        })
        .slice(0, limit)
        .map(clone);
    },
    async claim(runId, now, leaseUntil) {
      if (!runs.has(runId)) return false;
      const held = leases.get(runId);
      if (held !== undefined && held >= now) return false;
      leases.set(runId, leaseUntil);
      return true;
    },
    async release(runId) {
      leases.delete(runId);
    },
  };
};

export const demoWorkflowRunStore = createMemoryWorkflowRunStore();
