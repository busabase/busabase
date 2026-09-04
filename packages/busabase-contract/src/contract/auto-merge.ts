import { z } from "zod";

/**
 * `autoMerge` on a destructive-but-reversible operation.
 *
 * These six operations (record delete/restore, field delete/convert, Base
 * archive, mounted-asset content edits, and file batches containing a delete)
 * used to reject `autoMerge: true` outright: they queued for human review no
 * matter who called them. That made sense while the product was positioned as
 * approval-first, but it is not how Busabase is positioned or how the rest of
 * the write surface behaves — every other write is *permission-aware*
 * (`shouldAutoMerge`): unset + write access on the target node means "just do
 * it", and only an explicit `false` forces review.
 *
 * A single person running their own workspace hit the old behaviour as pure
 * friction: archiving one duplicate record left a change request they then had
 * to go and approve themselves. Reversibility is what makes the permission-aware
 * default safe here — delete ARCHIVES, archive is undone by restore, and a
 * field convert is preceded by `previewFieldConversion`. Callers who do want a
 * second pair of eyes still get it by passing an explicit `autoMerge: false`,
 * which is exactly how every other endpoint in this family expresses that.
 *
 * The schemas that use this are NOT `.strict()`, and making them strict is not
 * the fix: the SDK and CLI ship on their own npm cadence and busabase is
 * self-hosted, so a newer client sending a newer optional field to an older
 * server is normal traffic. Blanket strictness turns that graceful degradation
 * into a hard 400 for every field, to catch one.
 *
 * This lives in its own leaf module (zod only, no sibling imports) on purpose:
 * putting it in `contract/schemas.ts` created an import cycle with the domain
 * schema files that call it, and the failure was a runtime
 * `ReferenceError: Cannot access 'autoMergeNotAccepted' before initialization`
 * that `tsc` reported as clean.
 */
export const destructiveAutoMerge = (undoNote: string) =>
  z
    .boolean()
    .optional()
    .describe(
      "Whether to approve and merge this change immediately. Omitted defaults to merging " +
        "immediately if the actor has write access on the target node, otherwise falling back to " +
        `a pending Change Request; pass explicit false to force review even with write access. ${undoNote}`,
    );
