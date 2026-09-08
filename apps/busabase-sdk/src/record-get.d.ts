import type { RecordVO } from "busabase-contract/types";
import type { BusabaseClient } from "./client.js";
export interface RecordByFieldInput {
  baseId: string;
  fieldSlug: string;
  valueText: string;
}
/** The SDK retains the former field-addressed helper over the canonical get operation. */
export type BusabaseRecordsClient = BusabaseClient["records"] & {
  getByField(input: RecordByFieldInput): Promise<RecordVO | null>;
};
/**
 * Preserve the former nullable SDK result while the canonical REST operation
 * consistently reports a missing record as 404 for either selector mode.
 */
export declare const getRecordByField: (
  client: Pick<BusabaseClient, "records">,
  input: RecordByFieldInput,
) => Promise<RecordVO | null>;
