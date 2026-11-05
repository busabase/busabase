import {
  type WorkflowRecordSnapshot,
  WorkflowRecordSnapshotSchema,
} from "busabase-contract/domains/workflow/run";

/** Copy a record head into the frozen shape a workflow step stores. */
export const toWorkflowRecordSnapshot = (record: {
  id: string;
  baseId: string;
  headCommitId: string;
  headCommit: { payload: Record<string, unknown> };
}): WorkflowRecordSnapshot =>
  WorkflowRecordSnapshotSchema.parse({
    recordId: record.id,
    baseId: record.baseId,
    headCommitId: record.headCommitId,
    fields: structuredClone(record.headCommit.payload),
  });
