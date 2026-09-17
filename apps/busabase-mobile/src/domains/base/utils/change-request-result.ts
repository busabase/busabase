/**
 * Reading the result of "propose a change".
 *
 * `records.changeRequest`, `bases.createChangeRequest` and `views.changeRequest`
 * all return a DISCRIMINATED UNION, not a ChangeRequest:
 *
 *   { materialized: true,  ...the record / base / view itself }   // merged now
 *   { materialized: false, ...the pending ChangeRequest      }   // awaiting review
 *
 * Which one you get is permission-aware — a write-capable actor merges
 * immediately, which is the common case, not the edge case.
 *
 * Every mobile screen used to ignore the discriminant and navigate to
 * `/change-requests/<result.id>`. On the merged branch that id is a RECORD id,
 * so the user finished saving and landed on "Change request not found:
 * rec…" — with the write itself having succeeded. The doc editor sidestepped
 * this by hard-coding `autoMerge: false` (see the comment there); these helpers
 * are the actual fix, so a screen can tell the two apart instead of avoiding
 * one of them.
 */

/** The shape both branches share — enough to route on without importing the VOs. */
export interface ChangeRequestOutcome {
  id: string;
  materialized?: boolean;
}

/** True when the change is already live: `id` names the record/base/view itself. */
export const isMergedOutcome = (outcome: ChangeRequestOutcome): boolean =>
  outcome.materialized === true;

/**
 * The pending ChangeRequest's id, or `null` when the change merged immediately.
 * `null` is the signal "there is no review page to send anyone to".
 */
export const pendingChangeRequestId = (outcome: ChangeRequestOutcome): string | null =>
  isMergedOutcome(outcome) ? null : outcome.id;
