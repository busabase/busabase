import "server-only";

import { ORPCError } from "@orpc/server";

/** Caller-supplied baseId doesn't resolve — a genuine "not found" client error. */
export const baseNotFound = (baseId: string) =>
  new ORPCError("NOT_FOUND", { message: `Base not found: ${baseId}` });

/**
 * A Base always keeps at least one active view — it opens on its leftmost one.
 * Thrown at propose time and again inside the merge transaction. The dashboard
 * localizes this exact message (i18n/localize-error.ts), so keep them in sync.
 */
export const LAST_VIEW_DELETE_MESSAGE =
  "A Base must keep at least one view. Create another view before deleting this one.";

export const lastViewDeleteRejected = () =>
  new ORPCError("BAD_REQUEST", { message: LAST_VIEW_DELETE_MESSAGE });
