import { z } from "zod";

/**
 * `autoMerge` on an operation that deliberately never auto-merges.
 *
 * These schemas are NOT `.strict()` — and making them strict is not the fix. The
 * SDK and CLI ship on their own npm cadence (published ahead of the server as of
 * writing), and busabase is self-hosted, so a newer client sending a newer
 * optional field to an older server is normal traffic. Blanket strictness turns
 * that graceful degradation into a hard 400 for every field, to catch one.
 *
 * So reject exactly the field that actually confused callers, and say WHY plus
 * what to do instead — an agent reading "unrecognized key: autoMerge" learns
 * nothing it can act on, which is how the original silent-drop bug survived.
 *
 * Rejects `true` only. An explicit `false` asks for exactly what these operations
 * already do, so refusing it would be pedantry with a cost: every review-first
 * call site in this repo passes a uniform `autoMerge: false`, and clients that do
 * the same must not start collecting 400s on the subset of endpoints where the
 * flag happens to be moot. Same forward-compatibility argument that rules out
 * blanket `.strict()`.
 *
 * This lives in its own leaf module (zod only, no sibling imports) on purpose:
 * putting it in `contract/schemas.ts` created an import cycle with the domain
 * schema files that call it, and the failure was a runtime
 * `ReferenceError: Cannot access 'autoMergeNotAccepted' before initialization`
 * that `tsc` reported as clean.
 */
export const autoMergeNotAccepted = (reason: string) =>
  z
    .literal(false, { error: `\`autoMerge: true\` is not accepted here: ${reason}` })
    .optional()
    .describe(`Only \`false\` (or omitted) is accepted. ${reason}`);
