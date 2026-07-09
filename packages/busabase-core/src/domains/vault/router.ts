import { implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { getDb } from "../../db";
import { clearVaultSettings, getVaultSettings, updateVaultSettings } from "./logic/vault-logic";

const os = implement(busabaseContract);
const LOCAL_VAULT_OWNER_ID = null;

export const vaultRouter = {
  get: os.vault.get.handler(async () => getVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID)),
  update: os.vault.update.handler(async ({ input }) =>
    updateVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID, input),
  ),
  clear: os.vault.clear.handler(async () =>
    clearVaultSettings(await getDb(), LOCAL_VAULT_OWNER_ID),
  ),
};
