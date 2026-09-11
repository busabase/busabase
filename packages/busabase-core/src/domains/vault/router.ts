import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getContextFilePreviewConfig } from "../../context";
import { getDb } from "../../db";
import {
  clearVaultSettings,
  getVaultSettings,
  updatePreviewFileCredential,
  updateVaultSettings,
} from "./logic/vault-logic";

const os = implement(busabaseContract);
const LOCAL_VAULT_OWNER_ID = null;

export const vaultRouter = {
  get: os.vault.get.handler(async () => getVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID)),
  update: os.vault.update.handler(async ({ input }) =>
    updateVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID, input),
  ),
  updatePreviewFileCredential: os.vault.updatePreviewFileCredential.handler(async ({ input }) => {
    if (getContextFilePreviewConfig().vaultEncryptionConfigured === null) {
      throw new ORPCError("FORBIDDEN", {
        message: "PreviewFile credentials are managed by the host environment.",
      });
    }
    return updatePreviewFileCredential(await getDb(), LOCAL_VAULT_OWNER_ID, input.apiKey);
  }),
  clear: os.vault.clear.handler(async () =>
    clearVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID),
  ),
};
