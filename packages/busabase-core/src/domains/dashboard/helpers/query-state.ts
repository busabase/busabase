/** Show an initial skeleton until an unresolved query has produced authoritative data. */
export const shouldShowInitialLoadingState = (value: unknown, isFetching: boolean): boolean =>
  value == null && isFetching;
