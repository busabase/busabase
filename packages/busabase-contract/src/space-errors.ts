export const BUSABASE_SPACE_ERROR_REASONS = {
  notAllowed: "SPACE_NOT_ALLOWED",
  selectionRequired: "SPACE_SELECTION_REQUIRED",
} as const;

export type BusabaseSpaceErrorReason =
  (typeof BUSABASE_SPACE_ERROR_REASONS)[keyof typeof BUSABASE_SPACE_ERROR_REASONS];
