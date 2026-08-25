import type { BusabaseTaskClient, TaskDefinition } from "./types";

export interface RecordBulkUpdateInput {
  baseId: string;
  updates: unknown;
  message?: string;
  submittedBy?: string;
  idempotencyKey?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

const mergeIntent = (input: RecordBulkUpdateInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

export const recordBulkUpdateTask: TaskDefinition<RecordBulkUpdateInput> = {
  name: "record_bulk_update_change_request",
  cliPath: ["records", "bulk-update-change-request"],
  summary: "Propose partial updates to many records in one ChangeRequest",
  guidance:
    "All updates must target active records in the same Base. Each recordId may appear once. " +
    "Each fields object is a partial update: omitted keys stay unchanged and null clears a field. " +
    "The batch is reviewed and merged atomically. Use baseCommitId per update when the caller " +
    "must pin the version it read. Review is permission-aware; pass requireReview to force a " +
    "pending ChangeRequest even when the key has write access.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "baseId", kind: "string", required: true, description: "Base owning every record." },
    {
      name: "updates",
      kind: "json",
      required: true,
      description:
        'JSON array of {recordId, fields, baseCommitId?, message?}, e.g. [{"recordId":"rec_1","fields":{"status":"published"}}].',
    },
    { name: "message", kind: "string", description: "Reviewer-facing message for the batch." },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "idempotencyKey",
      kind: "string",
      description: "Retry key scoped to this Base and submitter.",
    },
    {
      name: "autoMerge",
      kind: "boolean",
      description: "Apply immediately when the actor has write access.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description: "Force one pending ChangeRequest even when the actor has write access.",
    },
  ],
  examples: [
    'busabase-cli records bulk-update-change-request --base-id bas_1 --updates-json \'[{"recordId":"rec_1","fields":{"status":"published"}}]\' --require-review',
    "busabase-cli records bulk-update-change-request --base-id bas_1 --updates-json @updates.json --idempotency-key august-review-v1",
  ],
  execute: async (client: BusabaseTaskClient, input: RecordBulkUpdateInput) => {
    if (!Array.isArray(input.updates)) {
      throw new Error("`updates` must be a JSON array.");
    }
    return client.bases.createBulkUpdateChangeRequest({
      baseId: input.baseId,
      updates: input.updates,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...mergeIntent(input),
    });
  },
};
