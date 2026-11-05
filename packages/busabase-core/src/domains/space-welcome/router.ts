import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  getContextCredentialPermissionCeiling,
  getContextIsSpaceManager,
  getContextPermissionLevel,
  getContextSpaceId,
  isAnonymousVisitor,
  isEmbedVisitor,
} from "../../context";
import { getDb } from "../../db";
import { getSpaceWelcome, type SpaceWelcomeActor, updateSpaceWelcome } from "./logic/space-welcome";

const os = implement(busabaseContract);

const actor = (): SpaceWelcomeActor => ({
  spaceId: getContextSpaceId(),
  isSpaceManager: getContextIsSpaceManager(),
  permissionLevel: getContextPermissionLevel(),
  credentialPermissionCeiling: getContextCredentialPermissionCeiling(),
  isVisitor: isAnonymousVisitor() || isEmbedVisitor(),
});

export const spaceWelcomeRouter = {
  get: os.spaceWelcome.get.handler(async () => getSpaceWelcome(await getDb(), actor())),
  update: os.spaceWelcome.update.handler(async ({ input }) =>
    updateSpaceWelcome(await getDb(), actor(), input),
  ),
};
