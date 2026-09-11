import { ORPCError } from "@orpc/client";

/**
 * Does this query error mean "this node simply has no form config yet"?
 *
 * `forms.getByNode` answers a missing form with `NOT_FOUND` rather than a null
 * body, so the client cannot tell "not configured" from "genuinely broken" by
 * looking at the data alone — both arrive as an error. Everything downstream of
 * that distinction is user-visible: not-configured is a calm, translated empty
 * state, while a real failure needs the message and a Retry button.
 *
 * Matched on the transport code, not on the message text: the message carries
 * the node id (`Form not found: nod123…`) and is not stable to match on.
 */
export const isFormNotConfiguredError = (error: unknown): boolean =>
  error instanceof ORPCError && error.code === "NOT_FOUND";
