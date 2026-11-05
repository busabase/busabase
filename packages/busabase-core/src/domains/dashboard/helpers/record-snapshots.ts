import type { RecordVO } from "busabase-contract/types";
import { isListPayloadOmitted } from "../utils/list-payload-preview";

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

type ComputedField = NonNullable<RecordVO["computedFields"]>[string];

const isComputedOmitted = (computed: ComputedField) =>
  isListPayloadOmitted(computed.value) ||
  computed.sources.some((source) => isListPayloadOmitted(source.value));

/** A compact row without markers holds the same values as a detail read. */
export function hasOmittedListValues(record: RecordVO): boolean {
  return (
    Object.values(record.headCommit.payload).some(isListPayloadOmitted) ||
    Object.values(record.computedFields ?? {}).some(isComputedOmitted)
  );
}

/** True when `candidate` is a later commit of the record than `current`. */
const isLaterCommit = (candidate: RecordVO, current: RecordVO): boolean =>
  candidate.headCommitId !== current.headCommitId &&
  (candidate.updatedAt > current.updatedAt ||
    (candidate.updatedAt === current.updatedAt &&
      Date.parse(candidate.headCommit.createdAt) > Date.parse(current.headCommit.createdAt)));

/**
 * The full read no longer describes what the list knows: either a later commit,
 * or a lookup that changed while the list could only return its omission marker.
 * Either way the complete value has to be read again.
 */
export function isFullReadBehind(
  fullRecord: RecordVO | null | undefined,
  listedRecord: RecordVO | null | undefined,
): boolean {
  if (!fullRecord || !listedRecord || fullRecord === listedRecord) return false;
  if (isLaterCommit(listedRecord, fullRecord)) return true;
  if (listedRecord.headCommitId !== fullRecord.headCommitId) return false;
  return Object.entries(listedRecord.computedFields ?? {}).some(
    ([slug, computed]) =>
      isComputedOmitted(computed) &&
      computed.dependencyVersion !== fullRecord.computedFields?.[slug]?.dependencyVersion,
  );
}

/**
 * Pick what a record page, dialog or edit form may render.
 *
 * - A row with omission markers is a bounded preview, so it never seeds them; a
 *   row without markers is complete and can render straight away.
 * - A full read never replaces a later commit, however complete it is. When the
 *   later commit only exists as a compact row, keep what is already on screen
 *   (a mounted editor holds the user's draft) or wait for the fresh read.
 */
export function resolveActiveRecord({
  fullRecord,
  listedRecord,
  requiresFullRead,
  shownRecord = null,
  fullReadSettled = false,
}: {
  fullRecord: RecordVO | null | undefined;
  listedRecord: RecordVO | null | undefined;
  requiresFullRead: boolean;
  shownRecord?: RecordVO | null;
  /** The re-read already ran and still returned this older commit. */
  fullReadSettled?: boolean;
}): RecordVO | null {
  if (!requiresFullRead) return listedRecord ?? null;
  const listedIsComplete = Boolean(listedRecord && !hasOmittedListValues(listedRecord));
  if (!fullRecord) return listedIsComplete ? (listedRecord ?? null) : shownRecord;
  if (!listedRecord) return fullRecord;
  if (isLaterCommit(listedRecord, fullRecord)) {
    if (listedIsComplete) return listedRecord;
    return shownRecord ?? (fullReadSettled ? fullRecord : null);
  }
  return overlayFreshListFields(fullRecord, listedRecord);
}

/**
 * Keep the freshest derived value without letting an omission marker replace
 * the full value the detail read already holds.
 */
const mergeComputedField = (
  detail: ComputedField | undefined,
  list: ComputedField,
): ComputedField => {
  if (!detail || !isComputedOmitted(list)) return list;
  return isListPayloadOmitted(list.value) ? detail : { ...list, sources: detail.sources };
};

/**
 * A Table row is compact, but its lookup results may be newer than a slow
 * records.get response. Keep every full field from the detail read and take
 * only the non-omitted values plus derived metadata from the newer row.
 */
export function overlayFreshListFields(detail: RecordVO, listRecord: RecordVO): RecordVO {
  if (
    detail.id !== listRecord.id ||
    detail.headCommitId !== listRecord.headCommitId ||
    detail.updatedAt !== listRecord.updatedAt
  ) {
    return detail;
  }

  const payload = { ...detail.headCommit.payload };
  for (const [slug, value] of Object.entries(listRecord.headCommit.payload)) {
    if (!isListPayloadOmitted(value)) payload[slug] = value;
  }
  const computedFields = listRecord.computedFields
    ? Object.fromEntries(
        Object.entries(listRecord.computedFields).map(([slug, computed]) => [
          slug,
          mergeComputedField(detail.computedFields?.[slug], computed),
        ]),
      )
    : detail.computedFields;

  return {
    ...detail,
    // A compact row does not resolve the people inside omitted values.
    fieldUsers:
      detail.fieldUsers || listRecord.fieldUsers
        ? { ...detail.fieldUsers, ...listRecord.fieldUsers }
        : undefined,
    computedFields,
    headCommit: {
      ...detail.headCommit,
      payload,
    },
  };
}
