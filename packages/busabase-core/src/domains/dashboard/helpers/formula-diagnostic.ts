import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { collectFieldRefs } from "../../base/formula/ast";
import { parseFormula, validateFormulaExpression } from "../../base/formula/index";
import { isListPayloadOmitted } from "../utils/list-payload-preview";

/** Partial inputs cannot distinguish a legitimate blank from a calculation error. */
export function formulaDependsOnOmittedValues(field: BaseFieldVO, record: RecordVO): boolean {
  const payload = record.headCommit.payload;
  if (!Object.values(payload).some(isListPayloadOmitted)) return false;

  const fields = new Map(record.base.fields.map((candidate) => [candidate.slug, candidate]));
  const fieldTypes = new Map(
    record.base.fields.map((candidate) => [candidate.slug, candidate.type]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let omitted = false;

  const visit = (candidate: BaseFieldVO): boolean => {
    if (visiting.has(candidate.slug) || visiting.size >= 128) return false;
    if (visited.has(candidate.slug)) return true;
    omitted ||= isListPayloadOmitted(payload[candidate.slug]);
    if (candidate.type === "formula") {
      const expression = candidate.options.formula?.expression ?? "";
      validateFormulaExpression(expression, candidate.slug, fieldTypes);
      visiting.add(candidate.slug);
      for (const slug of collectFieldRefs(parseFormula(expression))) {
        const dependency = fields.get(slug);
        if (!dependency || !visit(dependency)) return false;
      }
      visiting.delete(candidate.slug);
    }
    visited.add(candidate.slug);
    return true;
  };

  try {
    return visit(field) && omitted;
  } catch {
    // Invalid formulas still go through the existing diagnostic, not the partial-data fallback.
    return false;
  }
}
