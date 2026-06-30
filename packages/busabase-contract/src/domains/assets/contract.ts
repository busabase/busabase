import { oc } from "@orpc/contract";
import { z } from "zod";
import { AssetDetailVOSchema, AssetVOSchema } from "./types";

// Assets domain oRPC routes; composed into the root contract in
// contract/busabase.ts. The deduped Asset library + its where-used reverse index.
export const assetsContract = {
  list: oc
    .route({
      method: "GET",
      path: "/assets",
      tags: ["Assets"],
      summary: "List assets",
      successDescription: "Every asset in the space, with file metadata and usage counts.",
    })
    .output(z.array(AssetVOSchema)),
  get: oc
    .route({
      method: "GET",
      path: "/assets/{assetId}",
      tags: ["Assets"],
      summary: "Get asset detail",
      successDescription: "Asset metadata plus every place it is referenced (where-used).",
    })
    .input(z.object({ assetId: z.string() }))
    .output(AssetDetailVOSchema),
  delete: oc
    .route({
      method: "DELETE",
      path: "/assets/{assetId}",
      tags: ["Assets"],
      summary: "Delete asset",
      successDescription:
        "Removed the asset and, if no other row references its bytes, the stored object. Refused while the asset is still referenced (where-used).",
    })
    .input(z.object({ assetId: z.string() }))
    .output(z.object({ deleted: z.boolean() })),
};
