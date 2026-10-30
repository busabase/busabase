import { RECORD_GET_MANY_MAX_IDS } from "busabase-contract/domains/base/contract/record-schemas";
import type { RecordVO } from "busabase-contract/types";

/** Ids per `records.getMany` call — the contract's own upper bound. */
export const LINKED_RECORDS_CHUNK_SIZE = RECORD_GET_MANY_MAX_IDS;

/**
 * Dedupe, sort and chunk ids. Sorting is what keeps the chunk query keys
 * stable: the same id set always produces the same chunks, whatever order the
 * page happened to list them in.
 */
export const chunkRecordIds = (
  ids: readonly string[],
  size = LINKED_RECORDS_CHUNK_SIZE,
): string[][] => {
  const unique = [...new Set(ids.filter((id) => id.length > 0))].sort();
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
};

/**
 * True when the server has no such procedure — an older Busabase reached
 * through a remote tunnel, which predates `records.getMany`. Decided on the
 * oRPC code / HTTP status only, never the message. `records.getMany` itself
 * never answers NOT_FOUND (unknown ids go to `missingIds`), so on that call a
 * NOT_FOUND can only mean the procedure is missing.
 */
export const isMissingProcedureError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === "NOT_FOUND" || status === 404;
};

export interface LinkedRecordsResult {
  records: RecordVO[];
  missingIds: string[];
}

export interface LinkedRecordLoaders {
  getMany: (recordIds: string[], signal?: AbortSignal) => Promise<LinkedRecordsResult>;
  getOne: (recordId: string, signal?: AbortSignal) => Promise<RecordVO>;
}

/**
 * Load one chunk through `records.getMany`, falling back to one `records.get`
 * per id when the server does not have the batch procedure. In the fallback a
 * per-id NOT_FOUND is a missing record (same as `missingIds`); any other
 * per-id failure fails the chunk, so the caller never renders a stale title.
 */
export const fetchRecordsByIds = async (
  loaders: LinkedRecordLoaders,
  recordIds: string[],
  signal?: AbortSignal,
): Promise<LinkedRecordsResult> => {
  if (recordIds.length === 0) return { records: [], missingIds: [] };
  try {
    return await loaders.getMany(recordIds, signal);
  } catch (error) {
    if (!isMissingProcedureError(error)) throw error;
  }
  const settled = await Promise.allSettled(recordIds.map((id) => loaders.getOne(id, signal)));
  const records: RecordVO[] = [];
  const missingIds: string[] = [];
  settled.forEach((result, index) => {
    const id = recordIds[index] as string;
    if (result.status === "fulfilled") {
      records.push(result.value);
      return;
    }
    if (!isMissingProcedureError(result.reason)) throw result.reason;
    missingIds.push(id);
  });
  return { records, missingIds };
};
