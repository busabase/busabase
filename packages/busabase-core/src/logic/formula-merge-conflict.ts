import "server-only";

import { ORPCError } from "@orpc/server";

// Shared by the field handlers and CR lifecycle without a runtime import cycle.
export const isFormulaStaleConflict = Symbol("isFormulaStaleConflict");
export type FormulaStaleConflictTag = { [isFormulaStaleConflict]?: true };

export const formulaStaleConflict = (
  message: string,
  data: {
    reason: "formula_changed" | "formula_dependency_changed";
    fieldId?: string;
    fieldSlug: string;
    dependencySlug?: string;
  },
) => {
  const error = new ORPCError("CONFLICT", { message, data });
  (error as typeof error & FormulaStaleConflictTag)[isFormulaStaleConflict] = true;
  return error;
};
