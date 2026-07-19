import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useState } from "react";
import { useSearch } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { getRecordTitle } from "../helpers/change-request";
import { mergeSearchIntoHref } from "../helpers/link-search";

/**
 * Resolve which date field positions records on the grid. Honors the view's
 * `dateFieldSlug`; otherwise falls back to the first date field on the base.
 */
export const resolveDateField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  dateFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const dateFields = (base?.fields ?? fields).filter(
    (f) => f.type === "date" || f.type === "created_time" || f.type === "updated_time",
  );
  if (dateFieldSlug) {
    return dateFields.find((f) => f.slug === dateFieldSlug) ?? null;
  }
  return dateFields[0] ?? null;
};

// Local YYYY-MM-DD key for a Date (avoids UTC off-by-one from toISOString).
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Parse a record's date value (ISO string or YYYY-MM-DD) into a day key, or null.
const recordDayKey = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dayKey(parsed);
};

export function BusaBaseCalendar({
  activeView,
  base,
  fields,
  records,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  fields: BaseFieldVO[];
  records: RecordVO[];
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const dateField = resolveDateField(base, fields, activeView?.config.dateFieldSlug);
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  if (!dateField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.calendarNoDate}</div>
    );
  }

  // Bucket records by day.
  const recordsByDay = new Map<string, RecordVO[]>();
  for (const record of records) {
    const key = recordDayKey(record.headCommit.fields[dateField.slug]);
    if (!key) {
      continue;
    }
    if (!recordsByDay.has(key)) {
      recordsByDay.set(key, []);
    }
    recordsByDay.get(key)?.push(record);
  }

  // Build a 6-week grid starting on the Sunday on/before the 1st of the month.
  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  const todayKey = dayKey(today);
  const weekdays = messages.base.calendarWeekdays;

  return (
    <div className="pb-5">
      <div className="mb-3 flex items-center gap-2">
        <button
          aria-label={messages.base.calendarPrevMonth}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() =>
            setCursor((c) =>
              c.month === 0
                ? { year: c.year - 1, month: 11 }
                : { year: c.year, month: c.month - 1 },
            )
          }
          type="button"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label={messages.base.calendarNextMonth}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() =>
            setCursor((c) =>
              c.month === 11
                ? { year: c.year + 1, month: 0 }
                : { year: c.year, month: c.month + 1 },
            )
          }
          type="button"
        >
          <ChevronRight size={15} />
        </button>
        <div className="font-semibold text-sm">{monthLabel}</div>
        <button
          className="ml-1 rounded-md border border-border/70 bg-background px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          type="button"
        >
          {messages.base.calendarToday}
        </button>
      </div>

      <div className="grid grid-cols-7 border-border/50 border-t border-l">
        {weekdays.map((label) => (
          <div
            className="border-border/50 border-r border-b bg-muted/20 px-2 py-1.5 text-muted-foreground text-xs"
            key={label}
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === cursor.month;
          const dayRecords = recordsByDay.get(key) ?? [];
          return (
            <div
              className={`min-h-24 border-border/50 border-r border-b p-1.5 ${
                inMonth ? "" : "bg-muted/10 text-muted-foreground/50"
              }`}
              key={key}
            >
              <div
                className={`mb-1 text-right text-xs ${
                  key === todayKey
                    ? "inline-flex h-5 w-5 items-center justify-center justify-self-end rounded-full bg-primary font-medium text-primary-foreground"
                    : ""
                }`}
              >
                {day.getDate()}
              </div>
              <div className="flex flex-col gap-1">
                {dayRecords.slice(0, 4).map((record) => (
                  <Link
                    className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-foreground text-xs hover:bg-primary/20"
                    href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
                    key={record.id}
                    title={getRecordTitle(record, messages)}
                  >
                    {getRecordTitle(record, messages)}
                  </Link>
                ))}
                {dayRecords.length > 4 ? (
                  <span className="px-1 text-muted-foreground text-xs">
                    +{dayRecords.length - 4}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
