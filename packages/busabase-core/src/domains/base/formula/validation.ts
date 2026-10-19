import type { FieldType } from "busabase-contract/types";
import {
  detectFieldCycle,
  FormulaCycleError,
  FormulaError,
  validateFormulaExpression,
} from "./index";

/** Validate schema references and function calls before any record data is needed. */
export const assertValidFormulaField = (
  type: FieldType,
  slug: string,
  options: { formula?: { expression?: string } } | null | undefined,
  siblingFields: ReadonlyArray<{
    slug: string;
    type: FieldType;
    options?: { formula?: { expression?: string } } | null;
  }>,
): void => {
  if (type !== "formula") return;
  const expression = options?.formula?.expression;
  if (!expression) {
    throw new FormulaError(`Formula field requires options.formula.expression: ${slug}`);
  }
  validateFormulaExpression(
    expression,
    slug,
    new Map(siblingFields.map((field) => [field.slug, field.type])),
  );
  const graphFields = [
    ...siblingFields.filter((field) => field.slug !== slug),
    { slug, type, options: { formula: { expression } } },
  ];
  const cycle = detectFieldCycle(graphFields);
  if (cycle) throw new FormulaCycleError(cycle);
};
