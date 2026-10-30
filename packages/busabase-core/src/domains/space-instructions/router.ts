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
import {
  getSpaceInstructions,
  type SpaceInstructionsActor,
  updateSpaceInstructions,
} from "./logic/space-instructions";

const os = implement(busabaseContract);

const actor = (): SpaceInstructionsActor => ({
  spaceId: getContextSpaceId(),
  isSpaceManager: getContextIsSpaceManager(),
  permissionLevel: getContextPermissionLevel(),
  credentialPermissionCeiling: getContextCredentialPermissionCeiling(),
  isVisitor: isAnonymousVisitor() || isEmbedVisitor(),
});

export const spaceInstructionsRouter = {
  get: os.spaceInstructions.get.handler(async () => getSpaceInstructions(await getDb(), actor())),
  update: os.spaceInstructions.update.handler(async ({ input }) =>
    updateSpaceInstructions(await getDb(), actor(), input),
  ),
};
