import type { BaseFieldVO, ViewGroupByVO } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { CircleAlert, Clock3, Layers } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { fmt, useCoreLocale, useIString } from "../../../i18n";
import { gridGroupSummaryMessages } from "../../../i18n/grid-group-summary";
import { buildViewGroupBy, type ResolvedViewGrouping } from "../helpers/view-grouping";
import { SplitSubmitButton } from "./split-submit-button";
import { FIELD_TYPE_ICONS } from "./view-config-editor";

interface GroupDraft {
  fieldId: string | null;
  direction: "asc" | "desc";
}

const draftOf = (value: ResolvedViewGrouping | null): GroupDraft => ({
  fieldId: value?.field.id ?? null,
  direction: value?.direction ?? "asc",
});

/**
 * Toolbar control that picks the one field a table view groups by. Saves
 * through the same view-update path as the row-height control: apply merges
 * the change, propose queues it for review.
 */
export function GridGroupControl({
  value,
  hasStoredGrouping = value !== null,
  fields,
  onSubmit,
  disabled = false,
}: {
  /** The grouping currently rendered (null = ungrouped or a stale config). */
  value: ResolvedViewGrouping | null;
  /** The view stores a grouping, even one that no longer applies (so None can clear it). */
  hasStoredGrouping?: boolean;
  /** Fields that can be grouped by (select and checkbox). */
  fields: BaseFieldVO[];
  onSubmit: (groupBy: ViewGroupByVO[], mergeImmediately: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const copy = gridGroupSummaryMessages[useCoreLocale()];
  const resolveIString = useIString();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GroupDraft>(() => draftOf(value));
  const [saving, setSaving] = useState<"immediate" | "changeRequest" | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<GroupDraft | null>(null);
  const radioName = useId();
  const orderName = useId();
  const feedbackId = useId();
  const current = draftOf(value);
  const feedback = error ? copy.groupFailed : pending ? copy.groupPending : undefined;
  const draftField = fields.find((field) => field.id === draft.fieldId) ?? null;
  const unchanged =
    draft.fieldId === current.fieldId &&
    (draft.fieldId === null
      ? !hasStoredGrouping || value !== null
      : draft.direction === current.direction);
  const currentLabel = value
    ? fmt(copy.groupedBy, { field: resolveIString(value.field.name) })
    : copy.groupTitle;

  useEffect(() => {
    if (pending && pending.fieldId === current.fieldId && pending.direction === current.direction)
      setPending(null);
  }, [pending, current.fieldId, current.direction]);

  const submit = async (mergeImmediately: boolean) => {
    setSaving(mergeImmediately ? "immediate" : "changeRequest");
    setError(false);
    try {
      await onSubmit(buildViewGroupBy(draftField, draft.direction), mergeImmediately);
      setPending(mergeImmediately ? null : draft);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  };

  const orderOptions =
    draftField?.type === "checkbox"
      ? ([
          ["asc", copy.orderCheckboxAsc],
          ["desc", copy.orderCheckboxDesc],
        ] as const)
      : ([
          ["asc", copy.orderSelectAsc],
          ["desc", copy.orderSelectDesc],
        ] as const);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setDraft(draftOf(value));
            setError(false);
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-describedby={feedback ? feedbackId : undefined}
            aria-label={currentLabel}
            className={`relative inline-flex size-7 shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 @min-[640px]/view-controls:w-auto @min-[640px]/view-controls:max-w-48 @min-[640px]/view-controls:px-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 ${
              value
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border/70 bg-card text-muted-foreground"
            }`}
            data-grouped={value ? "true" : undefined}
            data-testid="group-control"
            disabled={disabled || Boolean(saving)}
            title={feedback ?? currentLabel}
            type="button"
          >
            <Layers aria-hidden className="size-3.5 shrink-0" />
            <span className="hidden truncate @min-[640px]/view-controls:inline">
              {currentLabel}
            </span>
            {feedback ? (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-0.5 right-0.5 rounded-full bg-card ${error ? "text-destructive" : "text-muted-foreground"}`}
                data-group-feedback={error ? "error" : "pending"}
              >
                {error ? <CircleAlert size={10} /> : <Clock3 size={10} />}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3">
          {pending ? <p className="text-muted-foreground text-xs">{copy.groupPending}</p> : null}
          <fieldset className="space-y-1" disabled={Boolean(saving)}>
            <legend className="mb-2 font-medium text-sm">{copy.groupBy}</legend>
            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
              <input
                checked={draft.fieldId === null}
                className="accent-foreground"
                data-testid="group-option-none"
                name={radioName}
                onChange={() => setDraft((previous) => ({ ...previous, fieldId: null }))}
                type="radio"
              />
              <span>{copy.groupNone}</span>
            </label>
            {fields.map((field) => {
              const Icon = FIELD_TYPE_ICONS[field.type];
              return (
                <label
                  className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                  key={field.id}
                >
                  <input
                    checked={draft.fieldId === field.id}
                    className="accent-foreground"
                    data-testid={`group-option-${field.slug}`}
                    name={radioName}
                    onChange={() =>
                      setDraft((previous) => ({
                        fieldId: field.id,
                        direction: previous.fieldId === field.id ? previous.direction : "asc",
                      }))
                    }
                    type="radio"
                  />
                  {Icon ? <Icon aria-hidden className="size-3.5 text-muted-foreground" /> : null}
                  <span className="min-w-0 truncate">{resolveIString(field.name)}</span>
                </label>
              );
            })}
            {fields.length === 0 ? (
              <p className="px-2 py-1 text-muted-foreground text-xs">{copy.groupNoFields}</p>
            ) : null}
          </fieldset>
          {draftField ? (
            <fieldset className="space-y-1" disabled={Boolean(saving)}>
              <legend className="mb-1 font-medium text-muted-foreground text-xs">
                {copy.groupOrder}
              </legend>
              <div className="grid grid-cols-2 gap-1">
                {orderOptions.map(([direction, label]) => (
                  <label
                    className={`flex min-h-8 cursor-pointer items-center justify-center rounded border px-2 py-1 text-center text-xs transition-colors ${
                      draft.direction === direction
                        ? "border-foreground/40 bg-accent text-foreground"
                        : "border-border/70 text-muted-foreground hover:bg-accent"
                    }`}
                    key={direction}
                  >
                    <input
                      checked={draft.direction === direction}
                      className="sr-only"
                      data-testid={`group-order-${direction}`}
                      name={orderName}
                      onChange={() => setDraft((previous) => ({ ...previous, direction }))}
                      type="radio"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {error ? (
            <p className="text-destructive text-xs" id={feedbackId} role="alert">
              {copy.groupFailed}
            </p>
          ) : null}
          <SplitSubmitButton
            changeRequestAction={{
              label: copy.propose,
              isLoading: saving === "changeRequest",
              onSubmit: () => void submit(false),
            }}
            disabled={unchanged || Boolean(saving)}
            dropdownPosition="below"
            immediateAction={{
              label: copy.apply,
              isLoading: saving === "immediate",
              onSubmit: () => void submit(true),
            }}
          />
        </PopoverContent>
      </Popover>
      {pending ? (
        <span className="sr-only" id={error ? undefined : feedbackId} role="status">
          {copy.groupPending}
        </span>
      ) : null}
      {error && !open ? (
        <span className="sr-only" id={feedbackId} role="alert">
          {copy.groupFailed}
        </span>
      ) : null}
    </div>
  );
}
