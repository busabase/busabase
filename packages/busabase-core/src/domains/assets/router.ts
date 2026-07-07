import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  confirmAssetUpload,
  deleteAsset,
  getAsset,
  listAssets,
  requestAssetUploadUrl,
} from "./handlers";

// Assets domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const assetsRouter = {
  createUploadUrl: os.assets.createUploadUrl.handler(async ({ input }) =>
    requestAssetUploadUrl(input),
  ),
  confirm: os.assets.confirm.handler(async ({ input }) => confirmAssetUpload(input)),
  list: os.assets.list.handler(async () => listAssets()),
  get: os.assets.get.handler(async ({ input }) => getAsset(input.assetId)),
  delete: os.assets.delete.handler(async ({ input }) => deleteAsset(input.assetId)),
};
