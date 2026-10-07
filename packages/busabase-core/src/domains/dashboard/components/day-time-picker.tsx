"use client";

import { Button } from "kui/button";
import { Calendar } from "kui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DayPickerLocale } from "react-day-picker";
import { de, enUS, es, fr, ja, ko, ptBR, vi, zhCN, zhTW } from "react-day-picker/locale";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import type { CoreLocale } from "../../../i18n/locales";
import {
  calendarDayToLocalDate,
  formatDayKey,
  localDateToCalendarDay,
  parseDateFieldValue,
} from "../../base/utils/date-value";

/** Month names, weekday names and the first day of the week, per UI locale. */
const DAY_PICKER_LOCALES: Record<CoreLocale, DayPickerLocale> = {
  en: enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  es,
  pt: ptBR,
  vi,
  fr,
  de,
};

const dayKeyToLocalDate = (dayKey: string): Date | undefined => {
  const parsed = parseDateFieldValue(dayKey);
  return parsed?.kind === "day" ? calendarDayToLocalDate(parsed.day) : undefined;
};

const TIME_OF_DAY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** `9:30` → `09:30`; anything that is not a 24-hour time → null. */
const normalizeTimeOfDay = (text: string): string | null => {
  const match = TIME_OF_DAY.exec(text.trim());
  return match ? `${match[1]?.padStart(2, "0")}:${match[2]}` : null;
};

interface DayTimePickerProps {
  ariaLabel: string;
  className: string;
  dataAttributes?: Record<`data-${string}`, string>;
  /** `YYYY-MM-DD` the calendar highlights, or "" for none. */
  day: string;
  disabled?: boolean;
  id: string;
  includeTime: boolean;
  /** `YYYY-MM-DD`; earlier days cannot be picked. */
  minDay?: string;
  /** Shows a Clear action when given and the picker has a value. */
  onClear?: () => void;
  /** Called with the picked day and time (`""` when there is no time box). */
  onPick: (day: string, time: string) => void;
  /** The text the trigger shows; `null` shows the empty-state prompt. */
  text: string | null;
  /** `HH:mm` shown in the time box; only used when `includeTime`. */
  time: string;
}

/**
 * A button showing a day (and optionally a 24-hour time), which opens a
 * calendar in the UI locale. Not a native `<input type="date">` — the browser
 * draws that one in ITS language and ignores `lang`. Shared by the Busabase
 * date field and the share-link expiry, so every date picker here reads and
 * behaves the same.
 */
export function DayTimePicker({
  ariaLabel,
  className,
  dataAttributes,
  day,
  disabled,
  id,
  includeTime,
  minDay,
  onClear,
  onPick,
  text,
  time,
}: DayTimePickerProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [open, setOpen] = useState(false);
  const [timeDraft, setTimeDraft] = useState(time);
  useEffect(() => setTimeDraft(time), [time]);
  const selected = day ? dayKeyToLocalDate(day) : undefined;
  const earliest = minDay ? dayKeyToLocalDate(minDay) : undefined;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          {...dataAttributes}
          aria-label={ariaLabel}
          className={`${className} flex items-center justify-between gap-2 text-left`}
          data-value={includeTime && day ? `${day}T${time}` : day}
          disabled={disabled}
          id={id}
          type="button"
        >
          <span
            className={`min-w-0 truncate ${text ? "" : "text-muted-foreground"}`}
            suppressHydrationWarning
          >
            {text ?? messages.base.pickDate}
          </span>
          <CalendarIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* On short screens the popover can open with less room than its height;
          scroll it inside the space Radix leaves rather than clipping its top. */}
      <PopoverContent
        align="start"
        className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
      >
        <Calendar
          autoFocus
          captionLayout="dropdown"
          defaultMonth={selected}
          disabled={earliest ? { before: earliest } : undefined}
          endMonth={new Date(new Date().getFullYear() + 50, 11)}
          formatters={{
            formatMonthDropdown: (month) => month.toLocaleString(locale, { month: "short" }),
          }}
          locale={DAY_PICKER_LOCALES[locale]}
          mode="single"
          onSelect={(date) => {
            const picked = formatDayKey(localDateToCalendarDay(date));
            if (includeTime) {
              onPick(picked, normalizeTimeOfDay(timeDraft) ?? "00:00");
            } else {
              onPick(picked, "");
              setOpen(false);
            }
          }}
          required
          selected={selected}
          startMonth={new Date(1900, 0)}
        />
        <div className="flex items-center gap-2 border-border/60 border-t p-2">
          {includeTime ? (
            <label className="flex flex-1 items-center gap-2 text-muted-foreground text-xs">
              {messages.base.timeOfDay}
              <input
                className="h-8 w-20 rounded-md border border-border/70 bg-card px-2 text-foreground text-sm outline-none focus:border-primary"
                data-testid="date-field-time"
                inputMode="numeric"
                onBlur={() => {
                  if (!normalizeTimeOfDay(timeDraft)) setTimeDraft(time);
                }}
                onChange={(event) => {
                  setTimeDraft(event.target.value);
                  const next = normalizeTimeOfDay(event.target.value);
                  if (next && day) onPick(day, next);
                }}
                placeholder="HH:MM"
                value={timeDraft}
              />
            </label>
          ) : (
            <span className="flex-1" />
          )}
          {text && onClear ? (
            <Button
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {messages.base.clear}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
