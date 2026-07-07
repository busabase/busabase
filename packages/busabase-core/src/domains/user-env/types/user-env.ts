import { z } from "zod";

const EnvVarKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "Use uppercase letters, numbers, and underscores");

const EnvVarValueSchema = z.string().max(8192);

export const EnvVarsSchema = z
  .record(EnvVarKeySchema, EnvVarValueSchema)
  .default({})
  .refine((env) => Object.keys(env).length <= 100, "At most 100 environment variables");
export type EnvVars = z.infer<typeof EnvVarsSchema>;

export const UserEnvVOSchema = z.object({
  userId: z.string().nullable(),
  env: EnvVarsSchema,
  updatedAt: z.string().nullable(),
});
export type UserEnvVO = z.infer<typeof UserEnvVOSchema>;

export const UpdateUserEnvInputSchema = z.object({
  env: EnvVarsSchema,
});
export type UpdateUserEnvDTO = z.infer<typeof UpdateUserEnvInputSchema>;

export const UserEnvSuccessSchema = z.object({ success: z.boolean() });
