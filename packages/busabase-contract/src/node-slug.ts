import { z } from "zod";

/** The address format shared by node creation and installation targets. */
export const NodeSlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/);
