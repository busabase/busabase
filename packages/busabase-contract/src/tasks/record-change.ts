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
}

export const recordChangeTask: TaskDefinition<RecordChangeInput> = {
  name: "record_change_request",
  cliPath: ["records", "change-request"],
  summary: "Propose a change to an existing record (update / delete / restore)",
  guidance:
    "Approval-first: proposes a ChangeRequest for a human, it does not write directly. " +
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
  ],
  examples: [
    'busabase-cli records change-request --record-id rec_1 --operation update --fields-json \'{"status":"published"}\'',
    "busabase-cli records change-request --record-id rec_1 --operation delete",
  ],
  execute: async (client: BusabaseTaskClient, input: RecordChangeInput) => {
    const common = {
      recordId: input.recordId,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
    };
    if (input.operation === "update") {
      if (!input.fields || typeof input.fields !== "object") {
        throw new Error('operation "update" requires `fields` (an object keyed by field slug).');
      }
      return client.records.updateChangeRequest({
        ...common,
        fields: input.fields,
      } as Parameters<BusabaseTaskClient["records"]["updateChangeRequest"]>[0]);
    }
    if (input.operation === "delete") {
      return client.records.deleteChangeRequest({
        ...common,
        deleteMode: "archive",
      } as Parameters<BusabaseTaskClient["records"]["deleteChangeRequest"]>[0]);
    }
    return client.records.restoreChangeRequest(
      common as Parameters<BusabaseTaskClient["records"]["restoreChangeRequest"]>[0],
    );
  },
};
