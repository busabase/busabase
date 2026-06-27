import { text } from "drizzle-orm/pg-core";
import { getContextSpaceId } from "../context";

/**
 * The tenant-scoping column shared by every busabase table.
 *
 * `$defaultFn` resolves the active space from the request-scoped
 * `AsyncLocalStorage` (see `../context`) at insert time, so EVERY ORM insert is
 * auto-tagged with the current space without touching a single insert site:
 * - `apps/busabase` (open source) never binds a context → `LOCAL_SPACE_ID`.
 * - `apps/busabase-cloud` runs handlers inside `runWithBusabaseContext({ spaceId })`
 *   → the authenticated user's active space.
 *
 * Read queries still filter by `getContextSpaceId()` explicitly (a default can
 * only tag writes, not constrain reads).
 *
 * No SQL-level default is set: the column is `NOT NULL` and the value always
 * comes from `$defaultFn`. Existing local databases self-heal via the
 * reset-on-migrate-failure path in `./index.ts`.
 */
export const spaceIdColumn = () =>
  text("space_id")
    .notNull()
    .$defaultFn(() => getContextSpaceId());
