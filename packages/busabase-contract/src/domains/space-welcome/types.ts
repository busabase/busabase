import { z } from "zod";

/**
 * The node types a space welcome may point at: the two that read as a page.
 * Shared by the server's validation, the settings picker, and the Home card,
 * so a type added here is accepted, offered, and rendered in one change.
 */
export const SPACE_WELCOME_NODE_TYPES = ["doc", "html"] as const;
export type SpaceWelcomeNodeType = (typeof SPACE_WELCOME_NODE_TYPES)[number];

export const isSpaceWelcomeNodeType = (type: string): type is SpaceWelcomeNodeType =>
  (SPACE_WELCOME_NODE_TYPES as readonly string[]).includes(type);

export const SpaceWelcomeVOSchema = z.object({
  spaceId: z.string(),
  /** The Doc or HTML node shown at the top of Home; `null` when none is chosen. */
  nodeId: z.string().nullable(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
});

export const UpdateSpaceWelcomeInputSchema = z.object({
  /** An existing Doc or HTML node id in this space, or `null` to clear the welcome. */
  nodeId: z.string().min(1).max(256).nullable(),
  expectedVersion: z.number().int().nonnegative(),
});

export type SpaceWelcomeVO = z.infer<typeof SpaceWelcomeVOSchema>;
export type UpdateSpaceWelcomeInput = z.infer<typeof UpdateSpaceWelcomeInputSchema>;
