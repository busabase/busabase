import "server-only";

import { ORPCError } from "@orpc/server";

/** Caller-supplied baseId doesn't resolve — a genuine "not found" client error. */
export const baseNotFound = (baseId: string) =>
  new ORPCError("NOT_FOUND", { message: `Base not found: ${baseId}` });
