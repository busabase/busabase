/**
 * Change requests still awaiting a decision — the statuses `closeChangeRequest`
 * accepts. Only these are search results: `merged` lives on as the record it
 * produced, `rejected`/`abandoned` never became workspace content.
 */
export const OPEN_CHANGE_REQUEST_STATUSES = [
  "in_review",
  "changes_requested",
  "approved",
  "conflict",
] as const;
