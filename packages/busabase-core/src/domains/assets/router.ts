import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import {
  confirmAssetUpload,
  deleteAsset,
  downloadAsset,
  getAsset,
  listAssets,
  requestAssetUploadUrl,
  updateAssetMetadata,
} from "./handlers";
import { editAssetContent } from "./logic/asset-edit-content-logic";
import { grepAssets, readAssetTextLines } from "./logic/asset-grep-logic";
import { createAssetTextUploadUrl, putAssetText } from "./logic/asset-texts-logic";

// Assets domain oRPC handler slice; aggregated into the kernel router (router.ts).
const os = implement(busabaseContract);

export const assetsRouter = {
  createUploadUrl: os.assets.createUploadUrl.handler(async ({ input }) =>
    requestAssetUploadUrl(input),
  ),
  confirm: os.assets.confirm.handler(async ({ input }) => confirmAssetUpload(input)),
  list: os.assets.list.handler(async () => listAssets()),
  get: os.assets.get.handler(async ({ input }) => getAsset(input.assetId)),
  updateMetadata: os.assets.updateMetadata.handler(async ({ input }) => updateAssetMetadata(input)),
  delete: os.assets.delete.handler(async ({ input }) => deleteAsset(input.assetId)),
  download: os.assets.download.handler(async ({ input }) => downloadAsset(input.assetId)),
  // Drive Grep Retrieval — see apps/busabase/content/spec/drive-grep-retrieval.md
  putText: os.assets.putText.handler(async ({ input }) => putAssetText(input)),
  createTextUploadUrl: os.assets.createTextUploadUrl.handler(async ({ input }) =>
    createAssetTextUploadUrl(input),
  ),
  grep: os.assets.grep.handler(async ({ input }) => grepAssets(input)),
  readTextLines: os.assets.readTextLines.handler(async ({ input }) => readAssetTextLines(input)),
  // Edit an asset's REAL mounted file content via ChangeRequest — see
  // asset-edit-content-logic.ts. Distinct from putText (disposable derived text).
  editContent: os.assets.editContent.handler(async ({ input }) => editAssetContent(input)),
};
