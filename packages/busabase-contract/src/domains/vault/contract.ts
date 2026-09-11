import { oc } from "@orpc/contract";
import {
  UpdatePreviewFileCredentialInputSchema,
  UpdateVaultSettingsInputSchema,
  VaultSettingsVOSchema,
  VaultSuccessSchema,
} from "./types";

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
  updatePreviewFileCredential: oc
    .route({
      method: "PUT",
      path: "/vault/previewfile",
      tags: ["Vault"],
      summary: "Set or remove the local PreviewFile credential",
      successDescription: "The credential was updated without returning its value.",
    })
    .input(UpdatePreviewFileCredentialInputSchema)
    .output(VaultSuccessSchema),
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
