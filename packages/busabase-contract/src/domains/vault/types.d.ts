import { z } from "zod";
export declare const VaultItemKeySchema: z.ZodString;
export declare const VaultItemKindSchema: z.ZodEnum<{
  secret: "secret";
  variable: "variable";
}>;
export type VaultItemKind = z.infer<typeof VaultItemKindSchema>;
export declare const VaultScopeTypeSchema: z.ZodEnum<{
  agent: "agent";
  api_key: "api_key";
  base: "base";
  personal: "personal";
  tool: "tool";
  workspace: "workspace";
}>;
export type VaultScopeType = z.infer<typeof VaultScopeTypeSchema>;
export declare const VaultEnvironmentSchema: z.ZodEnum<{
  development: "development";
  local: "local";
  production: "production";
  staging: "staging";
}>;
export type VaultEnvironment = z.infer<typeof VaultEnvironmentSchema>;
export declare const VaultAccessPolicySchema: z.ZodObject<
  {
    runtime: z.ZodDefault<z.ZodBoolean>;
    reveal: z.ZodDefault<z.ZodBoolean>;
    edit: z.ZodDefault<z.ZodBoolean>;
    share: z.ZodDefault<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type VaultAccessPolicy = z.infer<typeof VaultAccessPolicySchema>;
export declare const VaultItemInputSchema: z.ZodObject<
  {
    id: z.ZodOptional<z.ZodString>;
    kind: z.ZodEnum<{
      secret: "secret";
      variable: "variable";
    }>;
    key: z.ZodString;
    value: z.ZodString;
    scopeType: z.ZodDefault<
      z.ZodEnum<{
        agent: "agent";
        api_key: "api_key";
        base: "base";
        personal: "personal";
        tool: "tool";
        workspace: "workspace";
      }>
    >;
    scopeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodDefault<
      z.ZodEnum<{
        development: "development";
        local: "local";
        production: "production";
        staging: "staging";
      }>
    >;
    description: z.ZodDefault<z.ZodString>;
    access: z.ZodDefault<
      z.ZodObject<
        {
          runtime: z.ZodDefault<z.ZodBoolean>;
          reveal: z.ZodDefault<z.ZodBoolean>;
          edit: z.ZodDefault<z.ZodBoolean>;
          share: z.ZodDefault<z.ZodBoolean>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type VaultItemInput = z.infer<typeof VaultItemInputSchema>;
export declare const UpdateVaultSettingsInputSchema: z.ZodObject<
  {
    items: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodOptional<z.ZodString>;
          kind: z.ZodEnum<{
            secret: "secret";
            variable: "variable";
          }>;
          key: z.ZodString;
          value: z.ZodString;
          scopeType: z.ZodDefault<
            z.ZodEnum<{
              agent: "agent";
              api_key: "api_key";
              base: "base";
              personal: "personal";
              tool: "tool";
              workspace: "workspace";
            }>
          >;
          scopeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
          environment: z.ZodDefault<
            z.ZodEnum<{
              development: "development";
              local: "local";
              production: "production";
              staging: "staging";
            }>
          >;
          description: z.ZodDefault<z.ZodString>;
          access: z.ZodDefault<
            z.ZodObject<
              {
                runtime: z.ZodDefault<z.ZodBoolean>;
                reveal: z.ZodDefault<z.ZodBoolean>;
                edit: z.ZodDefault<z.ZodBoolean>;
                share: z.ZodDefault<z.ZodBoolean>;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type UpdateVaultSettingsDTO = z.infer<typeof UpdateVaultSettingsInputSchema>;
export declare const VaultItemVOSchema: z.ZodObject<
  {
    kind: z.ZodEnum<{
      secret: "secret";
      variable: "variable";
    }>;
    key: z.ZodString;
    value: z.ZodString;
    scopeType: z.ZodDefault<
      z.ZodEnum<{
        agent: "agent";
        api_key: "api_key";
        base: "base";
        personal: "personal";
        tool: "tool";
        workspace: "workspace";
      }>
    >;
    environment: z.ZodDefault<
      z.ZodEnum<{
        development: "development";
        local: "local";
        production: "production";
        staging: "staging";
      }>
    >;
    description: z.ZodDefault<z.ZodString>;
    access: z.ZodDefault<
      z.ZodObject<
        {
          runtime: z.ZodDefault<z.ZodBoolean>;
          reveal: z.ZodDefault<z.ZodBoolean>;
          edit: z.ZodDefault<z.ZodBoolean>;
          share: z.ZodDefault<z.ZodBoolean>;
        },
        z.core.$strip
      >
    >;
    id: z.ZodString;
    scopeId: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodString;
    createdAt: z.ZodString;
    lastUsedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export type VaultItemVO = z.infer<typeof VaultItemVOSchema>;
export declare const VaultSettingsVOSchema: z.ZodObject<
  {
    ownerId: z.ZodNullable<z.ZodString>;
    items: z.ZodArray<
      z.ZodObject<
        {
          kind: z.ZodEnum<{
            secret: "secret";
            variable: "variable";
          }>;
          key: z.ZodString;
          value: z.ZodString;
          scopeType: z.ZodDefault<
            z.ZodEnum<{
              agent: "agent";
              api_key: "api_key";
              base: "base";
              personal: "personal";
              tool: "tool";
              workspace: "workspace";
            }>
          >;
          environment: z.ZodDefault<
            z.ZodEnum<{
              development: "development";
              local: "local";
              production: "production";
              staging: "staging";
            }>
          >;
          description: z.ZodDefault<z.ZodString>;
          access: z.ZodDefault<
            z.ZodObject<
              {
                runtime: z.ZodDefault<z.ZodBoolean>;
                reveal: z.ZodDefault<z.ZodBoolean>;
                edit: z.ZodDefault<z.ZodBoolean>;
                share: z.ZodDefault<z.ZodBoolean>;
              },
              z.core.$strip
            >
          >;
          id: z.ZodString;
          scopeId: z.ZodNullable<z.ZodString>;
          updatedAt: z.ZodString;
          createdAt: z.ZodString;
          lastUsedAt: z.ZodNullable<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    updatedAt: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export type VaultSettingsVO = z.infer<typeof VaultSettingsVOSchema>;
export declare const VaultRuntimeEnvSchema: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
export type VaultRuntimeEnv = z.infer<typeof VaultRuntimeEnvSchema>;
export declare const VaultSuccessSchema: z.ZodObject<
  {
    success: z.ZodBoolean;
  },
  z.core.$strip
>;
