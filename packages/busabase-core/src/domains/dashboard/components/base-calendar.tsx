import { useInfiniteQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useEffect, useState } from "react";
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

/** Records per request within the current month's slice (server max is 100). */
const RANGE_PAGE_SIZE = 100;

export function BusaBaseCalendar({
  activeView,
  base,
  client,
  fields,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  fields: BaseFieldVO[];
}) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const dateField = resolveDateField(base, fields, activeView?.config.dateFieldSlug);
  const baseId = base?.id ?? "";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  // Build a 6-week grid starting on the Sunday on/before the 1st of the month,
  // in LOCAL time — unchanged from before. `gridEnd` is the day AFTER the grid's
  // last cell, so `[gridStart, gridEnd)` is exactly the 42 rendered days.
  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);

  // `Date#toISOString()` converts a LOCAL instant to its exact UTC equivalent —
  // this is what lets the server compare real timestamps with zero ambiguity
  // about the viewer's timezone, which it never has (see the `dateRange` doc on
  // `listRecordsPageInputSchema`). The client resolves the grid boundaries;
  // the server just compares.
  const rangeQuery = useInfiniteQuery({
    enabled: Boolean(baseId) && Boolean(dateField),
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        dateRange: {
          fieldSlug: dateField?.slug ?? "",
          gte: gridStart.toISOString(),
          lt: gridEnd.toISOString(),
        },
        page: pageParam as number,
        pageSize: RANGE_PAGE_SIZE,
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    queryKey: [
      "busabase",
      "calendar-range",
      baseId,
      activeView?.id ?? "",
      dateField?.slug ?? "",
      gridStart.toISOString(),
    ],
  });

  // A day cell's overflow badge ("+N") needs the TRUE count for every day in
  // the grid, not just the first page — so this month-scoped slice is drained
  // fully, same shape the old code used for the WHOLE Base. The difference is
  // what it's bounded by: a real calendar month, not however large the Base
  // has grown to. React Query gives no `data` for a not-yet-loaded queryKey
  // (switching months changes the key), so the grid never shows a stale
  // month's records while this runs.
  useEffect(() => {
    if (rangeQuery.hasNextPage && !rangeQuery.isFetchingNextPage) {
      void rangeQuery.fetchNextPage();
    }
  }, [rangeQuery.hasNextPage, rangeQuery.isFetchingNextPage, rangeQuery.fetchNextPage]);

  if (!dateField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.calendarNoDate}</div>
    );
  }

  const records = (rangeQuery.data?.pages ?? []).flatMap((page) => page.records);
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";
  // True until the month's slice has been fully drained — see the effect above.
  const isLoadingMonth =
    rangeQuery.isPending || rangeQuery.hasNextPage || rangeQuery.isFetchingNextPage;

  // Bucket records by day — unchanged from before; still local time, still
  // over whatever the current data set is (now the month's slice, not the Base).
  const recordsByDay = new Map<string, RecordVO[]>();
  for (const record of records) {
    const key = recordDayKey(record.headCommit.payload[dateField.slug]);
    if (!key) {
      continue;
    }
    if (!recordsByDay.has(key)) {
      recordsByDay.set(key, []);
    }
    recordsByDay.get(key)?.push(record);
  }

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
          className="ml-1 rounded-md border border-border/70 bg-card px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          type="button"
        >
          {messages.base.calendarToday}
        </button>
        {/* Never silent: a spinner while the month's slice loads, so an
            in-progress fetch can't be mistaken for a genuinely empty month. */}
        {isLoadingMonth ? (
          <span className="text-muted-foreground text-xs">{messages.common.loading}</span>
        ) : null}
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
