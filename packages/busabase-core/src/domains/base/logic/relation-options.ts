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
