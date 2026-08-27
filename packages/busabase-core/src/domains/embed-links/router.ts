import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import * as logic from "./logic";

const os = implement(busabaseContract);

export const embedLinksRouter = {
  create: os.embedLinks.create.handler(async ({ input }) => logic.createEmbedLink(input)),
  list: os.embedLinks.list.handler(async ({ input }) => logic.listEmbedLinks(input)),
  revoke: os.embedLinks.revoke.handler(async ({ input }) => logic.revokeEmbedLink(input.id)),
};
