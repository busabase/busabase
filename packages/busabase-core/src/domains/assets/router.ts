import { implement } from "@orpc/server";
import { busabaseContract } from "../../contract/busabase";
import { deleteAsset, getAsset, listAssets } from "./handlers";

// Assets domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const assetsRouter = {
  list: os.assets.list.handler(async () => listAssets()),
  get: os.assets.get.handler(async ({ input }) => getAsset(input.assetId)),
  delete: os.assets.delete.handler(async ({ input }) => deleteAsset(input.assetId)),
};
