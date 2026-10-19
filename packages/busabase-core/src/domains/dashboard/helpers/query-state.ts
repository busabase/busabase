/** Show an initial skeleton until an unresolved query has produced authoritative data. */
export const shouldShowInitialLoadingState = (value: unknown, isFetching: boolean): boolean =>
  value == null && isFetching;

/**
 * Does this error mean "there is no such thing", as opposed to "it broke"?
 * Duck-typed like dashboard-shell's `isPermissionDeniedError`: the error has
 * crossed the oRPC client boundary, so it carries `code` (an `ORPCError`) or a
 * plain HTTP `status`.
 */
export const isNotFoundError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === "NOT_FOUND" || status === 404;
};

/**
 * TanStack Query `retry` for a by-id read: a missing (or hidden) record is an
 * answer, so retrying it only keeps a skeleton up for seconds. Anything else
 * keeps the default three attempts.
 */
export const retryUnlessNotFound = (failureCount: number, error: unknown): boolean =>
  !isNotFoundError(error) && failureCount < 3;
