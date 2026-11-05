import { z } from "zod";

/**
 * Action name that re-reads the run's record at the moment the step executes.
 * Every other action name is recorded and skipped by this runtime.
 */
export const WORKFLOW_READ_RECORD_ACTION = "read_record";
/** Sets fields on the run's record, as the person the run acts as. */
export const WORKFLOW_UPDATE_RECORD_ACTION = "update_record";
/** Adds a record to a chosen Base, as the person the run acts as. */
export const WORKFLOW_CREATE_RECORD_ACTION = "create_record";
/** Moves a record to its Base's trash, as the person the run acts as. It can be restored. */
export const WORKFLOW_DELETE_RECORD_ACTION = "delete_record";

/**
 * Mixed freshness. Step outputs are snapshots from the moment that step ran,
 * including a function step's return value. `read_record` is the only step
 * that loads the record's current head, and it does so when it runs —
 * including after a Wait or approval pause.
 */
export const WORKFLOW_DATA_FRESHNESS = "snapshot-steps-plus-explicit-reread" as const;

/** Trigger event names the runtime subscribes to when `executionMode` is `event`. */
export const WORKFLOW_RECORD_EVENTS = ["record.created", "record.updated"] as const;
export type WorkflowRecordEvent = (typeof WORKFLOW_RECORD_EVENTS)[number];

export const isWorkflowRecordEvent = (value: string): value is WorkflowRecordEvent =>
  (WORKFLOW_RECORD_EVENTS as readonly string[]).includes(value);

/**
 * Who an approval step names, from its free-text `approver` field: the member
 * emails in it, separated by commas, semicolons, or spaces. Anything that is
 * not an email ("Sales lead") stays a label, which is what the field was
 * before approvers were enforced. No email means the step names nobody, and
 * anyone with write on the workflow may decide.
 */
export const parseWorkflowApprovers = (approver: string): string[] => [
  ...new Set(
    approver
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^@\s]+@[^@\s]+$/.test(entry)),
  ),
];

/**
 * How long a finished run (completed, failed, cancelled) is kept. The scheduler
 * deletes older ones. Runs that have not finished are never deleted.
 */
export const WORKFLOW_RUN_RETENTION_DAYS = 90;

export const WORKFLOW_DATA_FRESHNESS_SUMMARY =
  "Each finished step keeps the values it captured, including a function step's return value. A read_record action reads the record's current head when that step runs. After a Wait or approval, earlier outputs stay frozen; put read_record after the pause to branch on current data.";

export const WorkflowRecordSnapshotSchema = z.object({
  recordId: z.string(),
  baseId: z.string(),
  headCommitId: z.string(),
  fields: z.record(z.string(), z.unknown()),
});
export type WorkflowRecordSnapshot = z.infer<typeof WorkflowRecordSnapshotSchema>;

export const WorkflowStepOutputSchema = z.object({
  kind: z.string(),
  /** When this step finished. The record below, if any, is the head at this instant. */
  capturedAt: z.string(),
  /**
   * 0-based execution order within the run. Two steps can finish in the same
   * millisecond, and Postgres jsonb does not keep key order, so neither the
   * timestamp nor the key order of `outputs` can say which ran first.
   */
  sequence: z.number().int().min(0).optional(),
  record: WorkflowRecordSnapshotSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type WorkflowStepOutput = z.infer<typeof WorkflowStepOutputSchema>;

export const WorkflowPauseSchema = z.object({
  kind: z.enum(["wait", "approval"]),
  nodeId: z.string(),
  /** ISO time the wait may resume. Null for an approval pause. */
  resumeAt: z.string().nullable(),
});
export type WorkflowPause = z.infer<typeof WorkflowPauseSchema>;

export const WorkflowRunStatusSchema = z.enum([
  /** Started by a record event; the scheduler picks it up and runs it as `startedBy`. */
  "queued",
  "running",
  "waiting",
  "waiting_approval",
  "completed",
  "failed",
  /** Stopped by someone before it finished. Nothing after that point ran. */
  "cancelled",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

/**
 * The agent credential that started a run. The run acts as the key's owner, but
 * never with more than the key allows: the scheduler re-reads the key each time
 * it continues the run, so revoking or lowering it takes effect mid-run.
 */
export const WorkflowRunStartedViaSchema = z.object({
  apiKeyId: z.string().nullable(),
  apiKeyName: z.string().nullable(),
  channel: z.string().nullable(),
});
export type WorkflowRunStartedVia = z.infer<typeof WorkflowRunStartedViaSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  spaceId: z.string(),
  workflowNodeId: z.string(),
  status: WorkflowRunStatusSchema,
  /** How the run began. `event` runs were queued by a record event. */
  trigger: z.enum(["manual", "event"]),
  /**
   * Whose permissions the run uses when nobody is calling: the person who
   * started it, or for an event run the person who last saved the workflow in
   * event mode. A Wait that elapses resumes as this actor.
   */
  startedBy: z.string(),
  /** Set when an agent started the run rather than a person in the app. */
  startedVia: WorkflowRunStartedViaSchema.nullable().default(null),
  /** Who cancelled the run, when `status` is `cancelled`. */
  cancelledBy: z.string().nullable().default(null),
  cursorNodeId: z.string().nullable(),
  previousNodeId: z.string().nullable(),
  outputs: z.record(z.string(), WorkflowStepOutputSchema),
  recordId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  pause: WorkflowPauseSchema.nullable(),
  error: z.string().nullable(),
  freshness: z.literal(WORKFLOW_DATA_FRESHNESS),
  startedAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const StartWorkflowRunInputSchema = z.object({
  nodeId: z.string().min(1),
  /** Bound record. The trigger snapshots it immediately; later read_record steps re-read it. */
  recordId: z.string().min(1).optional(),
  /** Extra trigger data. Stored on the trigger step and never refreshed. */
  payload: z.record(z.string(), z.unknown()).optional(),
  /** When set, start at the trigger whose eventName matches. Otherwise the first trigger. */
  eventName: z.string().max(160).optional(),
});
export type StartWorkflowRunInput = z.infer<typeof StartWorkflowRunInputSchema>;

export const ListWorkflowRunsInputSchema = z.object({
  nodeId: z.string().min(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("How many runs to return. Default 20, at most 50."),
  cursor: z.string().min(1).optional().describe("`nextCursor` from the previous page."),
  runId: z
    .string()
    .min(1)
    .optional()
    .describe("Answer for this one run instead of a page, with what the caller may do to it."),
});
export type ListWorkflowRunsInput = z.infer<typeof ListWorkflowRunsInputSchema>;

export const ListWorkflowRunsOutputSchema = z.object({
  /** Newest first. */
  runs: z.array(WorkflowRunSchema),
  /**
   * Whether the caller may start, continue, or decide runs of this workflow
   * (write on the workflow node). Reading runs only needs read, so a viewer
   * gets the list with `canRun: false` and the UI hides those actions.
   */
  canRun: z.boolean(),
  /**
   * Runs in this page that wait for an approval the caller may decide: one of
   * the step's named approvers (or a space manager), or anyone with write when
   * the step names nobody.
   */
  decidableRunIds: z.array(z.string()),
  /** Opaque cursor for older runs, or null on the last page. */
  nextCursor: z.string().nullable(),
  /** Queued runs of this workflow, on any page: what "cancel all queued" would stop. */
  queuedCount: z.number().int().min(0),
  /** Display names for the `startedBy` and `cancelledBy` ids in this page. */
  actorNames: z.record(z.string(), z.string()),
});
export type ListWorkflowRunsOutput = z.infer<typeof ListWorkflowRunsOutputSchema>;

export const CancelWorkflowRunInputSchema = z.object({ runId: z.string().min(1) });
export type CancelWorkflowRunInput = z.infer<typeof CancelWorkflowRunInputSchema>;

export const CancelQueuedWorkflowRunsInputSchema = z.object({ nodeId: z.string().min(1) }).strict();
export type CancelQueuedWorkflowRunsInput = z.infer<typeof CancelQueuedWorkflowRunsInputSchema>;

export const CancelQueuedWorkflowRunsOutputSchema = z.object({
  cancelled: z.number().int().min(0),
});
export type CancelQueuedWorkflowRunsOutput = z.infer<typeof CancelQueuedWorkflowRunsOutputSchema>;

export const GetWorkflowRunInputSchema = z.object({ runId: z.string().min(1) });
export type GetWorkflowRunInput = z.infer<typeof GetWorkflowRunInputSchema>;

export const ResumeWorkflowRunInputSchema = z
  .object({
    runId: z.string().min(1),
    /**
     * Continue before the wait duration has elapsed. Without this, resume
     * succeeds only once `resumeAt` is in the past.
     */
    force: z.boolean().optional(),
  })
  .strict();
export type ResumeWorkflowRunInput = z.infer<typeof ResumeWorkflowRunInputSchema>;

export const DecideWorkflowRunInputSchema = z.object({
  runId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
});
export type DecideWorkflowRunInput = z.infer<typeof DecideWorkflowRunInputSchema>;

export const ResumeElapsedWorkflowRunsOutputSchema = z.object({
  runs: z.array(WorkflowRunSchema),
  /** Runs that could not be continued. One bad run does not stop the others. */
  failed: z.array(z.object({ runId: z.string(), message: z.string() })),
});
export type ResumeElapsedWorkflowRunsOutput = z.infer<typeof ResumeElapsedWorkflowRunsOutputSchema>;
