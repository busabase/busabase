import type { RecordVO } from "busabase-contract/types";

export interface RecordSnapshot {
  record: RecordVO | null | undefined;
  fetchedAt: number;
}

/** Hashes identify equality only. Prefer read-start dominance, never lexical hash order. */
function compareDependencyReads(current: RecordVO, previous: RecordVO): number {
  const fields = new Set([
    ...Object.keys(current.computedFields ?? {}),
    ...Object.keys(previous.computedFields ?? {}),
  ]);
  let direction = 0;
  for (const slug of fields) {
    const next = current.computedFields?.[slug];
    const before = previous.computedFields?.[slug];
    if (next?.dependencyVersion === before?.dependencyVersion) continue;
    if (!Number.isFinite(next?.dependencyReadAt) || !Number.isFinite(before?.dependencyReadAt))
      return 0;
    const delta = Math.sign((next?.dependencyReadAt ?? 0) - (before?.dependencyReadAt ?? 0));
    if (!delta || (direction && direction !== delta)) return 0;
    direction = delta;
  }
  return direction;
}

/** Derived cells can change without advancing the source record's commit. */
export function mergeRecordSnapshots(snapshots: readonly RecordSnapshot[]): RecordVO[] {
  const latest = new Map<string, RecordSnapshot>();
  for (const snapshot of snapshots) {
    const record = snapshot.record;
    if (!record) continue;
    const previous = latest.get(record.id);
    const dependencyOrder = previous?.record ? compareDependencyReads(record, previous.record) : 0;
    const commitOrder = previous?.record
      ? Math.sign(
          Date.parse(record.headCommit.createdAt) -
            Date.parse(previous.record.headCommit.createdAt),
        ) || 0
      : 0;
    const freshnessOrder = commitOrder || dependencyOrder;
    if (
      !previous?.record ||
      record.updatedAt > previous.record.updatedAt ||
      (record.updatedAt === previous.record.updatedAt &&
        (freshnessOrder > 0 || (freshnessOrder === 0 && snapshot.fetchedAt >= previous.fetchedAt)))
    ) {
      latest.set(record.id, snapshot);
    }
  }
  return [...latest.values()].flatMap(({ record }) => (record ? [record] : []));
}
