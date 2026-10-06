"use client";

import { useMemo } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import {
  type DateFieldDisplay,
  type DateFieldOptions,
  describeDateFieldValue,
  formatTimeZoneLabel,
  fromDateTimeInputValue,
  listTimeZones,
  toDateInputValue,
  toDateTimeInputValue,
} from "../../base/utils/date-value";
import { DayTimePicker } from "./day-time-picker";

/**
 * The `date` field type's read display, its editor, and its field settings —
 * the React side of `base/utils/date-value.ts`, shared by the grid, record
 * detail, Change Request diffs, bulk edit and generated Forms so every surface
 * reads a day and a time the same way.
 */

/** The native tooltip for a time-of-day value: what the writer typed, and the reader's clock. */
export const useDateFieldTooltip = (display: DateFieldDisplay | null): string | undefined => {
  const messages = useCoreI18n();
  if (!display) return undefined;
  const lines = [
    display.text,
    display.enteredAs ? fmt(messages.base.dateEnteredAs, { value: display.enteredAs }) : null,
    display.readerLocal
      ? fmt(messages.base.dateYourLocalTime, { value: display.readerLocal })
      : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
};

/**
 * One date cell: the text in the UI locale, plus a small "+1" / "-1" when the
 * reader's day differs from the day the writer typed, with the details in the
 * native tooltip. Returns `null` for a value that is not a date, so callers
 * can fall back to their own empty/raw rendering.
 */
export function DateFieldValue({
  className = "",
  options,
  value,
}: {
  className?: string;
  options?: DateFieldOptions | null;
  value: unknown;
}) {
  const locale = useCoreLocale();
  const display = describeDateFieldValue(value, { locale, options });
  const title = useDateFieldTooltip(display);
  if (!display) return null;
  return (
    <span
      className={`inline-flex min-w-0 items-baseline gap-1 ${className}`}
      suppressHydrationWarning
      title={title}
    >
      <span className="min-w-0 truncate">{display.text}</span>
      {display.dayShift !== 0 ? (
        <span className="shrink-0 rounded border border-border/70 bg-muted/40 px-1 text-[10px] text-muted-foreground leading-4">
          {`${display.dayShift > 0 ? "+" : ""}${display.dayShift}`}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The editor for a `date` value: a `DayTimePicker` in the UI locale. A day
 * field writes `YYYY-MM-DD`; a time-of-day field adds a 24-hour time box, read
 * and written in the field's zone (else the reader's), stored with that zone's
 * UTC offset, and says which zone the typed time is in.
 */
export function DateFieldInput({
  ariaLabel,
  className,
  dataAttributes,
  id,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className: string;
  dataAttributes?: Record<`data-${string}`, string>;
  id: string;
  onChange: (value: string) => void;
  options?: DateFieldOptions | null;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const includeTime = options?.includeTime === true;
  const zone = includeTime ? options?.timezone || undefined : undefined;
  // A time-of-day value as wall-clock `YYYY-MM-DDTHH:mm` in its zone, split in two.
  const wallTime = includeTime ? toDateTimeInputValue(value, zone) : "";
  const dayKey = includeTime ? wallTime.slice(0, 10) : toDateInputValue(value);
  const display = describeDateFieldValue(value, { locale, options });

  const write = (day: string, time: string) =>
    onChange(includeTime ? (fromDateTimeInputValue(`${day}T${time}`, zone) ?? "") : day);

  const picker = (
    <DayTimePicker
      ariaLabel={ariaLabel}
      className={className}
      dataAttributes={dataAttributes}
      day={dayKey}
      id={id}
      includeTime={includeTime}
      onClear={() => onChange("")}
      onPick={write}
      text={display?.text ?? null}
      time={wallTime.slice(11, 16)}
    />
  );
  if (!includeTime) return picker;
  return (
    <div className="min-w-0">
      {picker}
      <div className="mt-1 text-[11px] text-muted-foreground" suppressHydrationWarning>
        {fmt(messages.base.timeZoneHint, { zone: formatTimeZoneLabel(zone, locale) })}
      </div>
    </div>
  );
}

const selectClassName =
  "mt-1 h-8 w-full rounded-md border border-border/70 bg-card px-2.5 text-sm outline-none transition-colors focus:border-primary disabled:opacity-50";

/**
 * A date field's settings, shared by the Add Field and Edit field dialogs:
 * "Include time", and — only then — which zone everyone reads the time in.
 */
export function DateFieldOptionsEditor({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: DateFieldOptions) => void;
  value: DateFieldOptions;
}) {
  const messages = useCoreI18n();
  const zones = useMemo(() => listTimeZones(), []);
  const current = value.timezone ?? "";
  return (
    <div className="grid gap-3" data-testid="date-field-options">
      <label className="inline-flex items-center gap-2 text-muted-foreground text-sm">
        <input
          checked={value.includeTime === true}
          data-testid="date-field-include-time"
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { ...value, includeTime: true }
                : // A zone only means something with a time; drop it with the time.
                  { includeTime: false },
            )
          }
          type="checkbox"
        />
        {messages.base.includeTime}
      </label>
      {value.includeTime ? (
        <label className="block">
          <span className="text-muted-foreground text-xs">{messages.base.timeZone}</span>
          <select
            className={selectClassName}
            data-testid="date-field-timezone"
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.value
                  ? { includeTime: true, timezone: event.target.value }
                  : { includeTime: true },
              )
            }
            value={current}
          >
            <option value="">{messages.base.timeZoneViewerLocal}</option>
            {current && !zones.includes(current) ? (
              <option value={current}>{current}</option>
            ) : null}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
