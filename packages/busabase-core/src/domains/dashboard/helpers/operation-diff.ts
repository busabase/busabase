import type { BaseFieldVO, ChangeRequestVO, OperationVO } from "busabase-contract/types";

export interface FieldOrderDiffModel {
  afterIds: string[];
  afterPrimaryId: string | undefined;
  beforeIds: string[];
  beforePrimaryId: string | undefined;
  fieldsById: Map<string, BaseFieldVO>;
  movedIds: Set<string>;
  primaryChanged: boolean;
}

export const fieldOrderIds = (operation: OperationVO): string[] =>
  Array.isArray(operation.headCommit.fields.fieldIds)
    ? operation.headCommit.fields.fieldIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

export const sortedBaseFields = (changeRequest: ChangeRequestVO) =>
  (changeRequest.base?.fields ?? []).slice().sort((left, right) => left.position - right.position);

export const isFieldReorderOperation = (operation: OperationVO) =>
  operation.operation === "base_reorder_fields";

/**
 * Ids that keep their relative order between `before` and `after` — i.e. ids
 * belonging to EVERY maximum-length common subsequence of the two id lists,
 * not merely some one of them. This distinction matters: a plain "pick one
 * longest common subsequence" reduction is ambiguous whenever two ids could
 * each occupy the same slot (e.g. a pairwise swap), and picking an arbitrary
 * one would arbitrarily call one of the pair "moved" and the other not. Since
 * both ids in that pair, or all in a promoted-to-front reordering, genuinely
 * moved relative to each other, only an id that is the UNIQUE candidate for
 * its slot in every maximum ordering-preserving subsequence is safe to call
 * "unmoved".
 *
 * Implemented as the standard "elements in every LIS" reduction: since a
 * reorder is a permutation of the same id set, a common subsequence of
 * `before`/`after` corresponds to an increasing subsequence (by `before`
 * index) of `after` mapped through `before`'s positions. For each position i
 * in that mapped sequence, L[i]/R[i] are the longest increasing subsequence
 * lengths ending/starting at i; i sits on some maximum subsequence iff
 * L[i] + R[i] - 1 equals the overall max, and — grouping those by L[i]
 * ("slot") — a slot with exactly one candidate is forced into every maximum
 * subsequence (so that id is stable/unmoved); a slot with 2+ candidates is
 * ambiguous, so every id in it is treated as moved.
 *
 * O(n^2) DP, fine for a Base's field count (tens, not thousands).
 */
export const idsInLongestCommonSubsequence = (before: string[], after: string[]): Set<string> => {
  const beforeIndexById = new Map(before.map((id, index) => [id, index]));
  const common = after
    .map((id) => ({ id, beforeIndex: beforeIndexById.get(id) }))
    .filter(
      (entry): entry is { id: string; beforeIndex: number } => entry.beforeIndex !== undefined,
    );

  const n = common.length;
  if (n === 0) return new Set();

  const longestEndingAt = new Array<number>(n).fill(1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (
        common[j].beforeIndex < common[i].beforeIndex &&
        longestEndingAt[j] + 1 > longestEndingAt[i]
      ) {
        longestEndingAt[i] = longestEndingAt[j] + 1;
      }
    }
  }
  const longestStartingAt = new Array<number>(n).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) {
      if (
        common[j].beforeIndex > common[i].beforeIndex &&
        longestStartingAt[j] + 1 > longestStartingAt[i]
      ) {
        longestStartingAt[i] = longestStartingAt[j] + 1;
      }
    }
  }
  const total = Math.max(...longestEndingAt);

  const candidatesBySlot = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    if (longestEndingAt[i] + longestStartingAt[i] - 1 === total) {
      const slot = longestEndingAt[i];
      const bucket = candidatesBySlot.get(slot);
      if (bucket) bucket.push(common[i].id);
      else candidatesBySlot.set(slot, [common[i].id]);
    }
  }
  const stableIds = new Set<string>();
  for (const bucket of candidatesBySlot.values()) {
    if (bucket.length === 1) stableIds.add(bucket[0]);
  }
  return stableIds;
};

export const getFieldOrderDiffModel = (
  changeRequest: ChangeRequestVO,
  operation: OperationVO,
): FieldOrderDiffModel => {
  const beforeFields = sortedBaseFields(changeRequest);
  const beforeIds = beforeFields.map((field) => field.id);
  const afterIds = fieldOrderIds(operation);
  const fieldsById = new Map(beforeFields.map((field) => [field.id, field]));
  const stableIds = idsInLongestCommonSubsequence(beforeIds, afterIds);
  const movedIds = new Set(afterIds.filter((id) => !stableIds.has(id)));

  const beforePrimaryId = beforeIds[0];
  const afterPrimaryId = afterIds[0];

  return {
    afterIds,
    afterPrimaryId,
    beforeIds,
    beforePrimaryId,
    fieldsById,
    movedIds,
    primaryChanged: Boolean(
      beforePrimaryId && afterPrimaryId && beforePrimaryId !== afterPrimaryId,
    ),
  };
};
