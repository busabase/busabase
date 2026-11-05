import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatFormulaValue, previewFormulaField } from "../../base/formula/field-preview";
import { formulaDependsOnOmittedValues } from "../helpers/formula-diagnostic";

/** Never replace stored values with a new evaluation (NOW/TODAY may have advanced). */
export function FormulaValue({
  field,
  value,
  record,
}: {
  field: BaseFieldVO;
  value: unknown;
  record?: RecordVO;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const needsFullInputs =
    (value === null || value === undefined) &&
    record &&
    formulaDependsOnOmittedValues(field, record);
  const diagnostic =
    (value === null || value === undefined) && record && !needsFullInputs
      ? previewFormulaField({
          expression: field.options.formula?.expression ?? "",
          slug: field.slug,
          fields: record.base.fields,
          values: record.headCommit.payload,
          recordId: record.id,
          createdAtIso: record.createdAt,
          updatedAtIso: record.updatedAt,
        })
      : null;
  const error = diagnostic?.error;
  const text = needsFullInputs
    ? messages.operation.viewFullContent
    : error
      ? messages.formula.computationError
      : formatFormulaValue(value, field.options.formula, locale);
  return (
    <span
      className={error ? "text-rejected-strong" : undefined}
      data-testid={error ? "formula-cell-error" : "formula-cell-value"}
      title={error ? `${messages.formula.computationError}: ${error}` : text}
    >
      {text || "-"}
    </span>
  );
}
