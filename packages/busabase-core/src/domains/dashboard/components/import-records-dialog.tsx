"use client";

import type { BaseVO } from "busabase-contract/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Textarea } from "kui/textarea";
import { useMemo, useState } from "react";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { validateRecordFields } from "../../base/field-rules";
import { PASTE_MAX_ROWS, parsePastedTable } from "../helpers/paste-table";
import type { RecordSubmitOptions } from "../helpers/view-types";
import { SplitSubmitButton } from "./split-submit-button";

/**
 * Paste rows from a spreadsheet, see exactly what would be created, confirm.
 *
 * The preview is not a courtesy. The server validates the WHOLE batch and
 * rejects it on the first bad row, with a message that carries no row index — so
 * without client-side validation a 180-row paste fails unattributably. Every
 * parsed row is therefore checked here with the same `validateRecordFields` the
 * single-record editor uses, and offending rows are named before submit.
 */
export function ImportRecordsDialog({
  base,
  onOpenChange,
  onSubmit,
  open,
}: {
  base: BaseVO;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    base: BaseVO,
    rows: Array<Record<string, unknown>>,
    options?: RecordSubmitOptions,
  ) => Promise<void>;
  open: boolean;
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [text, setText] = useState("");
  const [dropInvalid, setDropInvalid] = useState(true);
  const [pending, setPending] = useState<"immediate" | "changeRequest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => (text.trim() ? parsePastedTable(text, base.fields) : null),
    [base.fields, text],
  );

  const rowIssues = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((row) => validateRecordFields(row, base.fields));
  }, [base.fields, parsed]);

  const invalidCount = rowIssues.filter((issues) => issues.length > 0).length;
  const importableRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.filter((_, index) => !dropInvalid || rowIssues[index]?.length === 0);
  }, [dropInvalid, parsed, rowIssues]);

  const overCap = importableRows.length > PASTE_MAX_ROWS;
  const mappedColumns = parsed?.columns.filter((column) => column.field) ?? [];
  const canSubmit = importableRows.length > 0 && mappedColumns.length > 0 && !overCap;

  const close = () => {
    if (pending) return;
    setText("");
    setError(null);
    onOpenChange(false);
  };

  const submit = async (mergeImmediately: boolean) => {
    if (!canSubmit) return;
    setPending(mergeImmediately ? "immediate" : "changeRequest");
    setError(null);
    try {
      await onSubmit(base, importableRows, { mergeImmediately });
      setText("");
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? localizeCoreErrorMessage(messages, caught.message)
          : messages.base.failedImportRecords,
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) close();
      }}
      open={open}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        showCloseButton={!pending}
      >
        <DialogHeader className="border-border/60 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle>{messages.base.importRecords}</DialogTitle>
          <DialogDescription>{messages.base.importPasteFormatNote}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <Textarea
            aria-label={messages.base.importPasteLabel}
            className="min-h-32 font-mono text-xs"
            data-testid="import-paste-box"
            onChange={(event) => setText(event.target.value)}
            placeholder={messages.base.importPastePlaceholder}
            value={text}
          />

          {parsed ? (
            <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="font-medium text-xs">{messages.base.importStepMap}</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {parsed.columns.map((column, index) => (
                  <li
                    // Headers can repeat in a pasted table, so the index is what
                    // makes the key unique here.
                    key={`${column.header}-${index}`}
                  >
                    <span className="font-mono">{column.header || "—"}</span>{" "}
                    {column.field ? (
                      <span className="text-muted-foreground">
                        {fmt(messages.base.importMappedTo, {
                          field: resolveIString(column.field.name),
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {column.unsupportedReason === "unmatched"
                          ? messages.base.importSkipColumn
                          : messages.base.importUnsupportedColumn}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-2 border-border/50 border-t pt-2 text-xs">
                <p data-testid="import-row-count">
                  {fmt(messages.base.importRowsParsed, {
                    count: parsed.rows.length,
                    plural: parsed.rows.length === 1 ? "" : "s",
                  })}
                </p>
                {invalidCount > 0 ? (
                  <>
                    <p className="mt-1 text-rejected-strong">
                      {fmt(messages.base.importRowsInvalid, {
                        count: invalidCount,
                        plural: invalidCount === 1 ? "" : "s",
                      })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {rowIssues
                        .map((issues, index) => ({ index, issues }))
                        .filter((entry) => entry.issues.length > 0)
                        .slice(0, 5)
                        .map((entry) => (
                          <li key={entry.index}>
                            {fmt(messages.base.importRowError, {
                              row: entry.index + 1,
                              field: entry.issues[0]?.slug ?? "",
                              message: entry.issues[0]?.message ?? "",
                            })}
                          </li>
                        ))}
                    </ul>
                    <label className="mt-1.5 flex items-center gap-2">
                      <input
                        checked={dropInvalid}
                        onChange={(event) => setDropInvalid(event.target.checked)}
                        type="checkbox"
                      />
                      {messages.base.importDropInvalidRows}
                    </label>
                  </>
                ) : null}
                {mappedColumns.length === 0 ? (
                  <p className="mt-1 text-rejected-strong">{messages.base.importNothingToImport}</p>
                ) : null}
                {overCap ? (
                  <p className="mt-1 text-rejected-strong">
                    {fmt(messages.base.importTooManyRows, { max: PASTE_MAX_ROWS })}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? <div className="mt-3 text-rejected-strong text-sm">{error}</div> : null}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-border/50 border-t pt-4">
            <button
              className="rounded-md border border-border/70 bg-card px-3 py-1.5 font-medium text-xs transition-colors hover:bg-accent disabled:opacity-50"
              disabled={Boolean(pending)}
              onClick={close}
              type="button"
            >
              {messages.common.cancel}
            </button>
            <SplitSubmitButton
              changeRequestAction={{
                label: fmt(messages.base.submitImportRequest, {
                  count: importableRows.length,
                  plural: importableRows.length === 1 ? "" : "s",
                }),
                loadingLabel: messages.base.submittingImportRequest,
                isLoading: pending === "changeRequest",
                onSubmit: () => void submit(false),
              }}
              disabled={Boolean(pending) || !canSubmit}
              hint={messages.base.importHint}
              immediateAction={{
                label: fmt(messages.base.importNow, {
                  count: importableRows.length,
                  plural: importableRows.length === 1 ? "" : "s",
                }),
                loadingLabel: messages.base.importing,
                isLoading: pending === "immediate",
                onSubmit: () => void submit(true),
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
