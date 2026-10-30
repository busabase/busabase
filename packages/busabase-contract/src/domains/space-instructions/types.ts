import { z } from "zod";

/** Shared by the settings editor and every transport; the limit is UTF-8 bytes. */
export const SPACE_INSTRUCTIONS_MAX_BYTES = 32 * 1024;

export const SpaceInstructionsBodySchema = z
  .string()
  .max(SPACE_INSTRUCTIONS_MAX_BYTES)
  .refine((body) => new TextEncoder().encode(body).byteLength <= SPACE_INSTRUCTIONS_MAX_BYTES, {
    message: `Space instructions must not exceed ${SPACE_INSTRUCTIONS_MAX_BYTES} UTF-8 bytes`,
  });

export const SpaceInstructionsVOSchema = z.object({
  spaceId: z.string(),
  body: SpaceInstructionsBodySchema,
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
});

export const UpdateSpaceInstructionsInputSchema = z.object({
  body: SpaceInstructionsBodySchema,
  expectedVersion: z.number().int().nonnegative(),
});

export type SpaceInstructionsVO = z.infer<typeof SpaceInstructionsVOSchema>;
export type UpdateSpaceInstructionsInput = z.infer<typeof UpdateSpaceInstructionsInputSchema>;
