import { oc } from "@orpc/contract";
import { UpdateVaultSettingsInputSchema, VaultSettingsVOSchema, VaultSuccessSchema } from "./types";

export const vaultContract = {
  get: oc
    .route({
      method: "GET",
      path: "/vault",
      tags: ["Vault"],
      summary: "Get local Vault settings",
      successDescription: "Local Vault secrets and variables for this Busabase instance.",
    })
    .output(VaultSettingsVOSchema),
  update: oc
    .route({
      method: "PUT",
      path: "/vault",
      tags: ["Vault"],
      summary: "Replace local Vault settings",
      successDescription: "Updated local Vault secrets and variables.",
    })
    .input(UpdateVaultSettingsInputSchema)
    .output(VaultSettingsVOSchema),
  clear: oc
    .route({
      method: "DELETE",
      path: "/vault",
      tags: ["Vault"],
      summary: "Clear local Vault settings",
      successDescription: "Removed local Vault secrets and variables.",
    })
    .output(VaultSuccessSchema),
};
