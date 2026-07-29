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

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("status" in error && error.status === 404) || ("code" in error && error.code === "NOT_FOUND"));

/**
 * Preserve the former nullable SDK result while the canonical REST operation
 * consistently reports a missing record as 404 for either selector mode.
 */
export const getRecordByField = async (
  client: Pick<BusabaseClient, "records">,
  input: RecordByFieldInput,
): Promise<RecordVO | null> => {
  try {
    return await client.records.get(input);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};
