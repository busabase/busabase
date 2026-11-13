import "server-only";

import { ORPCError } from "@orpc/server";
import { isSafeStorageKey } from "openlib/storage";

/** An owned text slot cannot make a reserved object or another attachment readable. */
export const assertReadableAssetTextKey = (
  row: { spaceId: string; textStorageKey: string; status?: string; writtenBy?: string },
  assetSpaceId: string | null,
  attachmentStorageKey: string | null,
): void => {
  if (assetSpaceId !== row.spaceId)
    throw new ORPCError("NOT_FOUND", { message: "Asset text parent is not in its workspace" });
  if (row.textStorageKey === "" && row.status === "none") return;
  const self = row.textStorageKey === attachmentStorageKey;
  if (
    !isSafeStorageKey(row.textStorageKey) ||
    (self
      ? !row.textStorageKey.startsWith("attachments/")
      : row.writtenBy === "auto" || !row.textStorageKey.startsWith("asset-texts/"))
  )
    throw new ORPCError("BAD_REQUEST", {
      message: "Asset text storage reference is not a readable content key",
    });
};
