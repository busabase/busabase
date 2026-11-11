import { GRID_ROW_HEIGHTS, type GridRowHeight } from "busabase-contract/types";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { CircleAlert, Clock3, Rows3 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useCoreLocale } from "../../../i18n";
import { gridRowHeightMessages } from "../../../i18n/grid-row-height";
import { SplitSubmitButton } from "./split-submit-button";

export function GridRowHeightControl({
  value,
  onSubmit,
  disabled = false,
}: {
  value: GridRowHeight;
  onSubmit: (height: GridRowHeight, mergeImmediately: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const copy = gridRowHeightMessages[useCoreLocale()];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState<"immediate" | "changeRequest" | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<GridRowHeight | null>(null);
  const radioName = useId();
  const feedbackId = useId();
  const feedback = error ? copy.failed : pending ? copy.pending : undefined;
  useEffect(() => {
    if (pending === value) setPending(null);
  }, [pending, value]);
  const submit = async (mergeImmediately: boolean) => {
    setSaving(mergeImmediately ? "immediate" : "changeRequest");
    setError(false);
    try {
      await onSubmit(draft, mergeImmediately);
      setPending(mergeImmediately ? null : draft);
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setDraft(value);
            setError(false);
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-describedby={feedback ? feedbackId : undefined}
            aria-label={`${copy.title}: ${copy[value]}`}
            className="relative inline-flex size-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-card font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 @min-[640px]/view-controls:w-auto @min-[640px]/view-controls:px-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
            data-testid="row-height-control"
            disabled={disabled || Boolean(saving)}
            title={feedback ?? `${copy.title}: ${copy[value]}`}
            type="button"
          >
            <Rows3 aria-hidden className="size-3.5" />
            <span className="hidden @min-[640px]/view-controls:inline">{copy.title}</span>
            {feedback ? (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-0.5 right-0.5 rounded-full bg-card ${error ? "text-destructive" : "text-muted-foreground"}`}
                data-row-height-feedback={error ? "error" : "pending"}
              >
                {error ? <CircleAlert size={10} /> : <Clock3 size={10} />}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 space-y-3 p-3">
          {pending ? <p className="text-muted-foreground text-xs">{copy.pending}</p> : null}
          <fieldset disabled={Boolean(saving)} className="space-y-1">
            <legend className="mb-2 font-medium text-sm">{copy.title}</legend>
            {(Object.keys(GRID_ROW_HEIGHTS) as GridRowHeight[]).map((preset) => (
              <label
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                key={preset}
              >
                <input
                  checked={draft === preset}
                  className="accent-foreground"
                  data-testid={`row-height-option-${preset}`}
                  name={radioName}
                  onChange={() => setDraft(preset)}
                  type="radio"
                  value={preset}
                />
                <span>{copy[preset]}</span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p className="text-destructive text-xs" id={feedbackId} role="alert">
              {copy.failed}
            </p>
          ) : null}
          <SplitSubmitButton
            changeRequestAction={{
              label: copy.propose,
              isLoading: saving === "changeRequest",
              onSubmit: () => void submit(false),
            }}
            immediateAction={{
              label: copy.apply,
              isLoading: saving === "immediate",
              onSubmit: () => void submit(true),
            }}
            disabled={draft === value || Boolean(saving)}
            dropdownPosition="below"
          />
        </PopoverContent>
      </Popover>
      {pending ? (
        <span className="sr-only" id={error ? undefined : feedbackId} role="status">
          {copy.pending}
        </span>
      ) : null}
      {error && !open ? (
        <span className="sr-only" id={feedbackId} role="alert">
          {copy.failed}
        </span>
      ) : null}
    </div>
  );
}
