import { z } from "zod";

const VaultItemKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "Use uppercase letters, numbers, and underscores");

const VaultItemValueSchema = z.string().max(8192);

export const VaultItemKindSchema = z.enum(["secret", "variable"]);
export type VaultItemKind = z.infer<typeof VaultItemKindSchema>;

export const VaultScopeTypeSchema = z.enum([
  "personal",
  "workspace",
  "base",
  "agent",
  "tool",
  "api_key",
]);
export type VaultScopeType = z.infer<typeof VaultScopeTypeSchema>;

export const VaultEnvironmentSchema = z.enum(["local", "development", "staging", "production"]);
export type VaultEnvironment = z.infer<typeof VaultEnvironmentSchema>;

export const VaultAccessPolicySchema = z.object({
  runtime: z.boolean().default(true),
  reveal: z.boolean().default(true),
  edit: z.boolean().default(true),
  share: z.boolean().default(false),
});
export type VaultAccessPolicy = z.infer<typeof VaultAccessPolicySchema>;

export const VaultItemInputSchema = z.object({
  id: z.string().optional(),
  kind: VaultItemKindSchema,
  key: VaultItemKeySchema,
  value: VaultItemValueSchema,
  scopeType: VaultScopeTypeSchema.default("personal"),
  scopeId: z.string().trim().nullable().optional(),
  environment: VaultEnvironmentSchema.default("local"),
  description: z.string().trim().max(512).default(""),
  access: VaultAccessPolicySchema.default({
    runtime: true,
    reveal: true,
    edit: true,
    share: false,
  }),
});
export type VaultItemInput = z.infer<typeof VaultItemInputSchema>;

export const UpdateVaultSettingsInputSchema = z.object({
  items: z.array(VaultItemInputSchema).max(200),
});
export type UpdateVaultSettingsDTO = z.infer<typeof UpdateVaultSettingsInputSchema>;

export const VaultItemVOSchema = VaultItemInputSchema.extend({
  id: z.string(),
  scopeId: z.string().nullable(),
  updatedAt: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type VaultItemVO = z.infer<typeof VaultItemVOSchema>;

export const VaultSettingsVOSchema = z.object({
  ownerId: z.string().nullable(),
  items: z.array(VaultItemVOSchema),
  updatedAt: z.string().nullable(),
});
export type VaultSettingsVO = z.infer<typeof VaultSettingsVOSchema>;

export const VaultRuntimeEnvSchema = z.record(VaultItemKeySchema, VaultItemValueSchema).default({});
export type VaultRuntimeEnv = z.infer<typeof VaultRuntimeEnvSchema>;

export const VaultSuccessSchema = z.object({ success: z.boolean() });
