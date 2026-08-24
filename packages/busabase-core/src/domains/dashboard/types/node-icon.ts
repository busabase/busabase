/**
 * A node's custom avatar (emoji or cropped/uploaded image) — the SAME wire
 * type the `NodeVO`/`NodeOutput` `icon` field and the `rename` change-request
 * operation's `icon` field carry (see `busabase-contract/contract/schemas.ts`).
 *
 * Re-exported here rather than re-declared: `busabase-contract` is a dependency
 * of `busabase-core` (never the reverse — see the domain-import convention in
 * CLAUDE.md), so `NodeIconSchema` must live there to be usable from BOTH the
 * wire contract and this package's DB column typing
 * (`db/schema.ts`'s `busabaseNodes.icon`). Declaring a second, independent copy
 * here would risk the two silently drifting; every other domain type file that
 * mirrors a contract-owned shape (e.g. `type { NodeVO } from
 * "busabase-contract/types"` used throughout `components/`) follows the same
 * re-export pattern instead of duplicating the schema.
 */

export type { NodeIcon } from "busabase-contract/types";
export { NodeIconSchema } from "busabase-contract/types";
