import type { BaseFieldVO } from "busabase-contract/types";
import { fmt, useCoreI18n } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { FieldValuePreview } from "./field-preview";

/** `bases.previewFieldConversion` output — the dry run behind a field type change. */
export interface ConversionPreview {
  totalCount: number;
  convertibleCount: number;
  nullCount: number;
  conflicts: Array<{ recordId: string; currentValue: unknown }>;
}

/** Whatever the caller's query hook reports, narrowed to what this panel reads. */
export interface ConversionPreviewState {
  data?: ConversionPreview | null;
  error: unknown;
  isPending: boolean;
}

/**
 * How many stored values the conversion CLEARS.
 *
 * Derived from the exact counts, never from `conflicts.length`: the server caps
 * the conflict SAMPLE at 100 (`PREVIEW_CONFLICT_SAMPLE_CAP`) while
 * `convertibleCount` stays exact, so reading the array's length silently
 * under-reports the damage on any Base with more than 100 affected rows.
 */
export const conversionLossCount = (preview: ConversionPreview) =>
  Math.max(preview.totalCount - preview.convertibleCount - preview.nullCount, 0);

/**
 * The dry run, rendered.
 *
 * Read-only on purpose and shared by both people who need this number: the
 * submitter picking a new type in the field dialog, and the approver about to
 * merge that change request (nothing locks the column in between, so the
 * approver's copy is fetched fresh rather than carried along by the operation).
 * A failed dry run renders the failure — an empty panel reading "0 values" is
 * the dangerous way to fail here.
 */
export function FieldConversionPreview({
  field,
  preview,
}: {
  field?: BaseFieldVO;
  preview: ConversionPreviewState;
}) {
  const messages = useCoreI18n();
  const lossCount = preview.data ? conversionLossCount(preview.data) : 0;

  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="font-medium text-xs">{messages.base.conversionPreviewTitle}</div>
      {preview.isPending ? (
        <p className="mt-1 text-muted-foreground text-xs">
          {messages.base.conversionPreviewLoading}
        </p>
      ) : preview.error ? (
        <p className="mt-1 text-rejected-strong text-xs">
          {localizeCoreErrorMessage(
            messages,
            preview.error instanceof Error
              ? preview.error.message
              : messages.base.conversionPreviewFailed,
          )}
        </p>
      ) : preview.data ? (
        <>
          <p
            className={`mt-1 font-medium text-sm ${
              lossCount > 0 ? "text-rejected-strong" : "text-muted-foreground"
            }`}
            data-testid="conversion-conflict-count"
          >
            {lossCount > 0
              ? fmt(messages.base.conversionConflicts, {
                  count: lossCount,
                  plural: lossCount === 1 ? "" : "s",
                })
              : messages.base.conversionNoConflicts}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {fmt(messages.base.conversionTotals, {
              total: preview.data.totalCount,
              convertible: preview.data.convertibleCount,
              nulls: preview.data.nullCount,
            })}
          </p>
          {lossCount > 0 ? (
            <>
              <ul className="mt-2 space-y-1">
                {preview.data.conflicts.slice(0, 10).map((conflict) => (
                  <li className="truncate text-xs" key={conflict.recordId}>
                    <FieldValuePreview field={field} value={conflict.currentValue} />
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted-foreground text-xs">
                {fmt(messages.base.conversionConflictSampleNote, {
                  shown: Math.min(preview.data.conflicts.length, 10),
                  count: lossCount,
                })}
              </p>
              <p className="mt-1 text-rejected-strong text-xs">
                {messages.base.conversionIrreversible}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
