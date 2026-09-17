"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO } from "busabase-contract/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Switch } from "kui/switch";
import { useState } from "react";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import { localizeCoreErrorMessage } from "../../../i18n/localize-error";
import { isSystemFieldType } from "../../base/field-types";
import type { RecordSubmitOptions } from "../helpers/view-types";
import { normalizeEditorFieldValue, RecordFieldInput } from "./record-views";
import { SplitSubmitButton } from "./split-submit-button";

/**
 * Set the same values on every selected row, as ONE atomic change request.
 *
 * Two things about this dialog are load-bearing rather than cosmetic:
 *
 * 1. **A field is only in the patch if its toggle is on.** The endpoint takes a
 *    PARTIAL patch — an omitted key keeps its current value — so "leave
 *    unchanged" has to mean *absent*, not "send the empty default". Sending the
 *    whole field set would blank every column the user never touched.
 * 2. **The scope is the loaded page, not the Base.** `selectedRecords` comes from
 *    the records currently rendered, so the header checkbox selects this page.
 *    That is survivable for delete (rows visibly vanish) and dangerous for edit
 *    (the user believes 3,000 rows now say Done), which is why the row count is
 *    spelled out in the body rather than implied by the button label.
 */
export function BulkEditRecordsDialog({
  base,
  client,
  onOpenChange,
  onSubmit,
  open,
  records,
}: {
  base: BaseVO;
  client: BusabaseDashboardApiClient;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    base: BaseVO,
    records: RecordVO[],
    fields: Record<string, unknown>,
    options?: RecordSubmitOptions,
  ) => Promise<void>;
  open: boolean;
  records: RecordVO[];
}) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const [enabledSlugs, setEnabledSlugs] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState<"immediate" | "changeRequest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Computed/system columns are written server-side and are rejected outright,
  // so they are absent rather than offered-then-refused.
  const editableFields = base.fields.filter((field) => !isSystemFieldType(field.type));

  const reset = () => {
    setEnabledSlugs(new Set());
    setDraft({});
    setError(null);
  };

  const close = () => {
    if (pending) return;
    reset();
    onOpenChange(false);
  };

  const toggleField = (field: BaseFieldVO, enabled: boolean) => {
    setEnabledSlugs((current) => {
      const next = new Set(current);
      if (enabled) next.add(field.slug);
      else next.delete(field.slug);
      return next;
    });
    if (enabled && !(field.slug in draft)) {
      setDraft((current) => ({ ...current, [field.slug]: normalizeEditorFieldValue(field, null) }));
    }
  };

  const submit = async (mergeImmediately: boolean) => {
    if (enabledSlugs.size === 0) {
      setError(messages.base.bulkEditNoFieldsChosen);
      return;
    }
    setPending(mergeImmediately ? "immediate" : "changeRequest");
    setError(null);
    try {
      const patch = Object.fromEntries(
        editableFields
          .filter((field) => enabledSlugs.has(field.slug))
          .map((field) => [field.slug, normalizeEditorFieldValue(field, draft[field.slug])]),
      );
      await onSubmit(base, records, patch, { mergeImmediately });
      reset();
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? localizeCoreErrorMessage(messages, caught.message)
          : messages.base.failedBulkEdit,
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
          <DialogTitle>{messages.base.bulkEditTitle}</DialogTitle>
          <DialogDescription>{messages.base.bulkEditDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <p className="text-muted-foreground text-xs" data-testid="bulk-edit-scope">
            {fmt(messages.base.bulkEditPageScopeNote, {
              count: records.length,
              plural: records.length === 1 ? "" : "s",
            })}
          </p>
          <div className="mt-3">
            {editableFields.map((field) => {
              const enabled = enabledSlugs.has(field.slug);
              return (
                <div className="border-border/40 border-b py-2" key={field.id}>
                  {/* Not a <label>: KUI's Switch renders a button, not an input,
                      so it carries its own aria-label instead. */}
                  <div className="flex items-center gap-2 text-sm">
                    <Switch
                      aria-label={fmt(messages.base.bulkEditSetTo, {
                        field: resolveIString(field.name),
                      })}
                      checked={enabled}
                      data-testid={`bulk-edit-toggle-${field.slug}`}
                      onCheckedChange={(checked) => toggleField(field, checked)}
                    />
                    <span className="truncate font-medium">{resolveIString(field.name)}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                      {enabled
                        ? messages.base.bulkEditSetToShort
                        : messages.base.bulkEditLeaveUnchanged}
                    </span>
                  </div>
                  {enabled ? (
                    <div className="mt-1">
                      <RecordFieldInput
                        client={client}
                        editorInstanceKey="bulk"
                        field={field}
                        onChange={(value) =>
                          setDraft((current) => ({ ...current, [field.slug]: value }))
                        }
                        records={records}
                        value={draft[field.slug]}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
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
                label: fmt(messages.base.submitUpdateRecordsRequest, {
                  count: records.length,
                  plural: records.length === 1 ? "" : "s",
                }),
                loadingLabel: messages.base.submittingUpdateRecordsRequest,
                isLoading: pending === "changeRequest",
                onSubmit: () => void submit(false),
              }}
              disabled={Boolean(pending) || enabledSlugs.size === 0}
              hint={messages.base.bulkEditHint}
              immediateAction={{
                label: fmt(messages.base.updateRecordsNow, { count: records.length }),
                loadingLabel: messages.base.updatingRecordsNow,
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
