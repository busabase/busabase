import { ORPCError } from "@orpc/server";
import {
  type ApiKeyPermissionLevel,
  hasApiKeyLevel,
} from "busabase-contract/access-control/api-key-level";
import {
  isSpaceWelcomeNodeType,
  SPACE_WELCOME_NODE_TYPES,
  type SpaceWelcomeVO,
  type UpdateSpaceWelcomeInput,
  UpdateSpaceWelcomeInputSchema,
} from "busabase-contract/domains/space-welcome/types";
import { and, eq } from "drizzle-orm";
import type { BusabaseDatabase } from "../../../context";
import { busabaseNodes } from "../../../db/schema";
import { busabaseSpaceWelcome } from "../schema/space-welcome";

/** Resolved by the host/router; the logic never accepts a caller-provided space id. */
export interface SpaceWelcomeActor {
  spaceId: string;
  isSpaceManager: boolean;
  permissionLevel: ApiKeyPermissionLevel;
  credentialPermissionCeiling?: ApiKeyPermissionLevel;
  isVisitor: boolean;
}

/** Same rules as space instructions: members and read keys read; managers write; link visitors neither. */
const assertAccess = (actor: SpaceWelcomeActor, required: "read" | "manage") => {
  if (
    actor.isVisitor ||
    !hasApiKeyLevel(actor.permissionLevel, required) ||
    (actor.credentialPermissionCeiling !== undefined &&
      !hasApiKeyLevel(actor.credentialPermissionCeiling, required)) ||
    (required === "manage" && !actor.isSpaceManager)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: `Requires ${required} workspace access to the space welcome page`,
    });
  }
};

const toVO = (row: typeof busabaseSpaceWelcome.$inferSelect): SpaceWelcomeVO => ({
  spaceId: row.spaceId,
  nodeId: row.nodeId,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The chosen node must be a live Doc or HTML node in THIS space.
 *
 * Refusals are `BAD_REQUEST`, never `NOT_FOUND`, on purpose: the CLI ships
 * separately from servers and reads a 404 on this route as "this server does
 * not have the welcome endpoint yet". A missing node is a bad argument.
 */
const assertWelcomeNode = async (db: BusabaseDatabase, spaceId: string, nodeId: string) => {
  const [node] = await db
    .select({
      type: busabaseNodes.type,
      archivedAt: busabaseNodes.archivedAt,
      deletedAt: busabaseNodes.deletedAt,
    })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, nodeId), eq(busabaseNodes.spaceId, spaceId)))
    .limit(1);
  if (!node || node.deletedAt) {
    throw new ORPCError("BAD_REQUEST", {
      message: `No node with id "${nodeId}" exists in this space. Pass the id of a Doc or HTML node (not its slug).`,
    });
  }
  if (node.archivedAt) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Node "${nodeId}" is archived. Restore it, or choose another Doc or HTML node.`,
    });
  }
  if (!isSpaceWelcomeNodeType(node.type)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Node "${nodeId}" is a ${node.type}; the welcome page must be one of: ${SPACE_WELCOME_NODE_TYPES.join(", ")}.`,
    });
  }
};

export const getSpaceWelcome = async (
  db: BusabaseDatabase,
  actor: SpaceWelcomeActor,
): Promise<SpaceWelcomeVO> => {
  assertAccess(actor, "read");
  const [row] = await db
    .select()
    .from(busabaseSpaceWelcome)
    .where(eq(busabaseSpaceWelcome.spaceId, actor.spaceId))
    .limit(1);
  return row ? toVO(row) : { spaceId: actor.spaceId, nodeId: null, version: 0, updatedAt: null };
};

export const updateSpaceWelcome = async (
  db: BusabaseDatabase,
  actor: SpaceWelcomeActor,
  input: UpdateSpaceWelcomeInput,
): Promise<SpaceWelcomeVO> => {
  assertAccess(actor, "manage");
  const { nodeId, expectedVersion } = UpdateSpaceWelcomeInputSchema.parse(input);
  if (nodeId !== null) await assertWelcomeNode(db, actor.spaceId, nodeId);
  const updatedAt = new Date();
  // An insert race is the same conflict as an update race: never overwrite a
  // row that appeared after the editor loaded its initial empty state.
  const [row] =
    expectedVersion === 0
      ? await db
          .insert(busabaseSpaceWelcome)
          .values({ spaceId: actor.spaceId, nodeId, version: 1, updatedAt })
          .onConflictDoNothing({ target: busabaseSpaceWelcome.spaceId })
          .returning()
      : await db
          .update(busabaseSpaceWelcome)
          .set({ nodeId, version: expectedVersion + 1, updatedAt })
          .where(
            and(
              eq(busabaseSpaceWelcome.spaceId, actor.spaceId),
              eq(busabaseSpaceWelcome.version, expectedVersion),
            ),
          )
          .returning();
  if (!row) {
    throw new ORPCError("CONFLICT", {
      message: "The welcome page changed. Reload the latest version before saving again.",
    });
  }
  return toVO(row);
};
