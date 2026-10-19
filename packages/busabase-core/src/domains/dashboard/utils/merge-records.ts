import type { RecordVO } from "busabase-contract/types";

/** Lists and record-detail queries refresh independently; never let an older
 * cached commit win simply because its query appears first. */
export function mergeFreshRecords(candidates: (RecordVO | null | undefined)[]): RecordVO[] {
  const merged = new Map<string, RecordVO>();
  for (const record of candidates) {
    if (!record) continue;
    const previous = merged.get(record.id);
    if (
      !previous ||
      Date.parse(record.updatedAt) > Date.parse(previous.updatedAt) ||
      (record.updatedAt === previous.updatedAt &&
        Date.parse(record.headCommit.createdAt) > Date.parse(previous.headCommit.createdAt))
    ) {
      merged.set(record.id, record);
    }
  }
  return [...merged.values()];
}
