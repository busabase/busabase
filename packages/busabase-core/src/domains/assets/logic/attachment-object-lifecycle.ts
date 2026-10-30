import "server-only";

import type { AttachmentObjectLifecycle } from "open-domains/attachments/logic";
import { generateNanoID } from "openlib/nanoid";
import { isStorageKeyRetired, withStorageKeyRegistration } from "./storage-cleanup-logic";

/** A retired content-addressed key belongs to an older, permanently deleted generation. */
export const resolveAttachmentUploadKey: AttachmentObjectLifecycle["resolveUploadKey"] = async (
  db,
  storageKey,
) => {
  if (!(await isStorageKeyRetired(db, storageKey))) return storageKey;
  const extension = storageKey.lastIndexOf(".");
  const insertion = extension > storageKey.lastIndexOf("/") ? extension : storageKey.length;
  return `${storageKey.slice(0, insertion)}-${generateNanoID()}${storageKey.slice(insertion)}`;
};

/** RPC hosts share the same object fence independently of their quota policy. */
export const busabaseAttachmentObjectLifecycle: AttachmentObjectLifecycle = {
  resolveUploadKey: resolveAttachmentUploadKey,
  register: withStorageKeyRegistration,
};
