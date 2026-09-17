import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import { busabaseBases } from "../../../db/schema";

/**
 * Let a relation field name its target Base by **slug** instead of the raw
 * `bse_...` id: agents rarely know the id but always know the slug they just chose.
 * Given a field's `options`, if `targetBaseSlug` is present, resolve it to
 * `targetBaseId` (scoped to the active space, active bases only) and drop the slug
 * so what persists is always the canonical id.
 *
 * Idempotent and safe to run on every field: a no-op when there's no
 * `targetBaseSlug`, and an explicit `targetBaseId` always wins (the slug is just an
 * alias). Run at the point user input is first accepted so downstream commits,
 * merges, and relation links only ever see a real id.
 *
 * Takes the `db` handle explicitly (rather than calling `getDb()`) so it can run
 * both outside a transaction (create paths) and INSIDE the merge transaction via
 * `ctx.db` — re-acquiring the getDb() singleton mid-transaction deadlocks pglite.
 */
export const resolveRelationFieldOptions = async <T extends Record<string, unknown>>(
  db: Awaited<ReturnType<typeof getDb>>,
  options: T,
): Promise<T> => {
  const slug = options.targetBaseSlug;
  if (typeof slug !== "string" || slug.length === 0) {
    return options;
  }

  const resolved: Record<string, unknown> = { ...options };
  delete resolved.targetBaseSlug;

  // An explicit id wins — the slug was a convenience alias, so just drop it.
  if (typeof options.targetBaseId === "string" && options.targetBaseId.length > 0) {
    return resolved as T;
  }

  const [target] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.slug, slug),
        eq(busabaseBases.spaceId, getContextSpaceId()),
        isNull(busabaseBases.archivedAt),
      ),
    )
    .limit(1);
  if (!target) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Relation target base not found by slug "${slug}". Pass an existing active Base slug, or its targetBaseId.`,
      data: { targetBaseSlug: slug },
    });
  }
  resolved.targetBaseId = target.id;
  return resolved as T;
};

/** Field types for which `options.multiple` is a real, READ switch. */
const MULTIPLE_AWARE_TYPES = new Set(["relation", "member"]);

/**
 * `options.multiple` decides whether a cell holds one id or a list. Two field types read
 * it — `relation` (one linked record or many) and `member` (one person or many, the
 * "Owner vs Reviewers" distinction) — and they are the two whose editors in
 * `record-views.tsx` branch on it. Nothing reads it for any other field type.
 *
 * The field `options` bag is shared across every field type, so before this guard a
 * `select` happily accepted, persisted, and then ignored `multiple: true`: the schema read
 * as multi-valued and the mistake only surfaced at the first record write, as
 * `must be one of its options`. A list of choices is its own field type — `multiselect` —
 * which is what the error points at.
 *
 * Rejects the key's PRESENCE, not just `true`: `multiple: false` on a `select` is equally
 * meaningless, and one rule is easier to reason about than two.
 */
/**
 * Refuse a multi→single flip that would silently truncate existing cells.
 *
 * `options.multiple` is only a schema flag; nothing rewrites the stored values
 * when it changes. So a column that already holds three ids keeps holding three
 * after the flip — and the next person to open and save that record writes back
 * `ids[0]` alone (see `getEditorFieldValue`), losing the other two with no
 * error, no prompt and no undo. The loss is attributed to whoever touched the
 * record, not to whoever changed the schema.
 *
 * Rejecting is deliberately blunter than migrating: truncating on the user's
 * behalf is still destroying data, just sooner. This way the person who wants
 * one owner per row decides which owner, on the rows that actually have several.
 *
 * Applies to `relation` as well as `member` — same storage shape, same silent
 * loss, and it has always been reachable there.
 */
export const assertNoMultiValueTruncationOrThrow = (slug: string, rowsWithSeveral: number) => {
  if (rowsWithSeveral === 0) {
    return;
  }
  throw new ORPCError("BAD_REQUEST", {
    message:
      `Field "${slug}": ${rowsWithSeveral} record${rowsWithSeveral === 1 ? "" : "s"} ` +
      "still hold more than one value, and switching to single-value would drop all but " +
      "the first the next time each record is saved. Reduce those records to one value first.",
    data: { slug, rowsWithSeveral },
  });
};

export const assertRelationOnlyOptionsOrThrow = (
  type: string,
  slug: string,
  options: Record<string, unknown> | null | undefined,
) => {
  if (!options || MULTIPLE_AWARE_TYPES.has(type) || !("multiple" in options)) {
    return;
  }
  const useMultiselect =
    type === "select" ? ' For a multi-value choice field use type "multiselect".' : "";
  throw new ORPCError("BAD_REQUEST", {
    message: `Field "${slug}": options.multiple only applies to relation and member fields, not "${type}".${useMultiselect}`,
    data: { slug, type },
  });
};
