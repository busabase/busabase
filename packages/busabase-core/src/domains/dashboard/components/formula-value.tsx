import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { formatFormulaValue, previewFormulaField } from "../../base/formula/field-preview";
import { formulaDependsOnOmittedValues } from "../helpers/formula-diagnostic";
import { buildTableCellPreview } from "../helpers/table-cell-preview";

/** Never replace stored values with a new evaluation (NOW/TODAY may have advanced). */
export function FormulaValue({
  field,
  value,
  record,
  maxChars,
}: {
  field: BaseFieldVO;
  value: unknown;
  record?: RecordVO;
  /** Grid previews bound values before formatting; full record views remain complete. */
  maxChars?: number;
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
  const preview = maxChars === undefined ? undefined : buildTableCellPreview(value, maxChars);
  const previewValue = preview?.truncated
    ? typeof value === "string"
      ? value.slice(0, maxChars)
      : preview.text
    : value;
  const text = needsFullInputs
    ? messages.operation.viewFullContent
    : error
      ? messages.formula.computationError
      : formatFormulaValue(previewValue, field.options.formula, locale);
  const truncated = preview?.truncated || (maxChars !== undefined && text.length > maxChars);
  const display = maxChars === undefined ? text : text.slice(0, maxChars);
  const title = error ? `${messages.formula.computationError}: ${error}` : text;
  return (
    <span
      className={error ? "text-rejected-strong" : undefined}
      data-testid={error ? "formula-cell-error" : "formula-cell-value"}
      data-formula-preview-bounded={truncated ? "true" : undefined}
      title={maxChars === undefined ? title : title.slice(0, maxChars)}
    >
      {display || "-"}
      {truncated ? "…" : null}
    </span>
  );
}
