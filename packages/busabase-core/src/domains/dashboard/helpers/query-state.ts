import { VIEW_TOO_LARGE_MESSAGE } from "../../../i18n/localize-error";

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

/** The server's "this view has too many records" answer, after the oRPC client boundary. */
export const isViewTooLargeError = (error: unknown): boolean =>
  error instanceof Error && error.message === VIEW_TOO_LARGE_MESSAGE;

/**
 * `retry` for a read of a view's records. A view too large to read fails the
 * same way every time, after the full 15 s of database time, so trying again
 * only repeats that work, and the reader — who sees the message once the last
 * try is over — waits for it. Anything else keeps the default three attempts.
 */
export const retryRecordRead = (failureCount: number, error: unknown): boolean =>
  !isViewTooLargeError(error) && failureCount < 3;
