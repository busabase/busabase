import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * Changing an existing record: update, delete (archive), or restore — one task
 * with an `operation`, rather than three `records_*_change_request` tools whose
 * names differ by one word in the middle.
 *
 * Worth stating plainly in the tool description because the wire semantics are
 * not what the names suggest: `delete` archives (reversible), it does not erase.
 */

const OPERATIONS = ["update", "delete", "restore"] as const;
type RecordOperation = (typeof OPERATIONS)[number];

export interface RecordChangeInput {
  recordId: string;
  operation: RecordOperation;
  fields?: unknown;
  message?: string;
  submittedBy?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/**
 * `autoMerge` is tri-state — unset (permission-aware default), forced on, forced
 * off — but a CLI boolean flag is presence-only, so `--auto-merge` alone could
 * never express "forced off". Same two-flag shape as `node_create`.
 */
const mergeIntent = (input: RecordChangeInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

export const recordChangeTask: TaskDefinition<RecordChangeInput> = {
  name: "record_change_request",
  cliPath: ["records", "change-request"],
  summary: "Propose a change to an existing record (update / delete / restore)",
  guidance:
    "Review is permission-aware for all three operations, decided server-side: the change merges " +
    "immediately when your key has write access on the Base's node and lands as a pending " +
    "ChangeRequest otherwise — check the response's `materialized` field to see which happened. " +
    "Pass explicit `autoMerge: false` to force review even when you could write directly. " +
    "`delete` ARCHIVES the record — it is reversible with `restore`, not an erase. " +
    "For update, `fields` is keyed by field slug and only needs the fields you are changing; " +
    "if you set the Base's PRIMARY (first) field, keep it a short human-readable title.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "recordId", kind: "string", required: true, description: "Record to change." },
    {
      name: "operation",
      kind: "enum",
      required: true,
      choices: OPERATIONS,
      description: "What to propose. Choose this before the other arguments.",
    },
    {
      name: "fields",
      kind: "json",
      appliesWhen: { param: "operation", values: ["update"] },
      description: 'New values keyed by field slug, e.g. {"status":"published"} (update only).',
    },
    {
      name: "message",
      kind: "string",
      description:
        'Explanation for the reviewer — imperative verb + what + why, e.g. "Update deal stage to qualified — demo booked".',
    },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Skip review and apply the change immediately if you have write access. Not a permission override — a changeRequest-level key still gets a pending CR. Default is permission-aware: merge when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description:
        "Always propose a pending ChangeRequest instead of applying the change, even with write access.",
    },
  ],
  examples: [
    'busabase-cli records change-request --record-id rec_1 --operation update --fields-json \'{"status":"published"}\'',
    'busabase-cli records change-request --record-id rec_1 --operation update --fields-json \'{"status":"published"}\' --require-review',
    "busabase-cli records change-request --record-id rec_1 --operation delete",
  ],
  execute: async (client: BusabaseTaskClient, input: RecordChangeInput) => {
    // Straight pass-through: `records.changeRequest` carries the same
    // update/delete/restore discriminator this task exposes.
    type RecordInput = Parameters<BusabaseTaskClient["records"]["changeRequest"]>[0];
    const common = {
      recordId: input.recordId,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
    };
    if (input.operation === "update") {
      if (!input.fields || typeof input.fields !== "object") {
        throw new Error('operation "update" requires `fields` (an object keyed by field slug).');
      }
      return client.records.changeRequest({
        ...common,
        operation: "update",
        fields: input.fields,
        ...mergeIntent(input),
      } as RecordInput);
    }
    // delete/restore carry the merge intent too — their schemas used to have no
    // `autoMerge` at all, so this used to drop the caller's flag on the floor.
    if (input.operation === "delete") {
      return client.records.changeRequest({
        ...common,
        operation: "delete",
        deleteMode: "archive",
        ...mergeIntent(input),
      } as RecordInput);
    }
    return client.records.changeRequest({
      ...common,
      operation: "restore",
      ...mergeIntent(input),
    } as RecordInput);
  },
};
