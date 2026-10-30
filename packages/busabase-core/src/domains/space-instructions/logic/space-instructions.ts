import { ORPCError } from "@orpc/server";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import {
  type SpaceInstructionsVO,
  type UpdateSpaceInstructionsInput,
  UpdateSpaceInstructionsInputSchema,
} from "busabase-contract/domains/space-instructions/types";
import { and, eq } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseSpaceInstructions } from "../schema/space-instructions";

/** Resolved by the host/router; the logic never accepts a caller-provided space id. */
export interface SpaceInstructionsActor {
  spaceId: string;
  isSpaceManager: boolean;
  permissionLevel: ApiKeyPermissionLevel;
  credentialPermissionCeiling?: ApiKeyPermissionLevel;
  isVisitor: boolean;
}

const assertAccess = (actor: SpaceInstructionsActor, required: "read" | "manage") => {
  if (
    actor.isVisitor ||
    !hasApiKeyLevel(actor.permissionLevel, required) ||
    (actor.credentialPermissionCeiling !== undefined &&
      !hasApiKeyLevel(actor.credentialPermissionCeiling, required)) ||
    (required === "manage" && !actor.isSpaceManager)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires ${required} workspace access to space instructions`,
    });
  }
};

const toVO = (row: typeof busabaseSpaceInstructions.$inferSelect): SpaceInstructionsVO => ({
  spaceId: row.spaceId,
  body: row.body,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

export const getSpaceInstructions = async (
  db: BusabaseDatabase,
  actor: SpaceInstructionsActor,
): Promise<SpaceInstructionsVO> => {
  assertAccess(actor, "read");
  const [row] = await db
    .select()
    .from(busabaseSpaceInstructions)
    .where(eq(busabaseSpaceInstructions.spaceId, actor.spaceId))
    .limit(1);
  return row ? toVO(row) : { spaceId: actor.spaceId, body: "", version: 0, updatedAt: null };
};

export const updateSpaceInstructions = async (
  db: BusabaseDatabase,
  actor: SpaceInstructionsActor,
  input: UpdateSpaceInstructionsInput,
): Promise<SpaceInstructionsVO> => {
  assertAccess(actor, "manage");
  const { body, expectedVersion } = UpdateSpaceInstructionsInputSchema.parse(input);
  const updatedAt = new Date();
  // An insert race is the same conflict as an update race: never overwrite a
  // row that appeared after the editor loaded its initial empty state.
  const [row] =
    expectedVersion === 0
      ? await db
          .insert(busabaseSpaceInstructions)
          .values({ spaceId: actor.spaceId, body, version: 1, updatedAt })
          .onConflictDoNothing({ target: busabaseSpaceInstructions.spaceId })
          .returning()
      : await db
          .update(busabaseSpaceInstructions)
          .set({ body, version: expectedVersion + 1, updatedAt })
          .where(
            and(
              eq(busabaseSpaceInstructions.spaceId, actor.spaceId),
              eq(busabaseSpaceInstructions.version, expectedVersion),
            ),
          )
          .returning();
  if (!row) {
    throw new ORPCError("CONFLICT", {
      message: "Space instructions changed. Reload the latest version before saving again.",
    });
  }
  return toVO(row);
};
