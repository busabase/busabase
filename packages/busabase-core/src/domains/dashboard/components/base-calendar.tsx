import {
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, RecordVO, ViewVO } from "busabase-contract/types";
import { Dialog, DialogTitle } from "kui/dialog";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import {
  getCalendarDateRange,
  getCalendarDayRange,
  getDateFieldDayKey,
  getDateFieldOptions,
} from "../../base/utils/date-value";
import { resolveDateField } from "../../base/utils/view-field-resolution";
import { getRecordTitle } from "../helpers/change-request";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { retryRecordRead } from "../helpers/query-state";
import { useIsAnonymousVisitor } from "../visitor-context";
import { rescheduledCalendarValue } from "./calendar-reschedule";
import { DialogContent } from "./localized-dialog-content";
import { useWorkspacePermissionLevel } from "./split-submit-button";

// Local YYYY-MM-DD key for a Date (avoids UTC off-by-one from toISOString).
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The day a record sits on. `created_time` / `updated_time` are always real
// instants (one that happens to fall on UTC midnight is still an instant, not
// a day), so they keep reading in local time; a `date` field goes through the
// shared date-value rules.
const recordDayKey = (field: BaseFieldVO, value: unknown): string | null => {
  if (field.type === "date") {
    return getDateFieldDayKey(value, getDateFieldOptions(field.options));
  }
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dayKey(parsed);
};

/** Records per request within the current month's slice (server max is 100). */
const RANGE_PAGE_SIZE = 100;
/**
 * A month grid that fits in this many pages is read whole and bucketed here,
 * exactly. A busier one — a month of a very large Base — asks each day for its
 * first few records and its count instead, so it stays 42 small reads.
 */
const MAX_DRAINED_PAGES = 10;
/** Records a day cell shows before its "+N". */
const DAY_PREVIEW_COUNT = 4;
/** Records per page in one day's full list. */
const DAY_LIST_PAGE_SIZE = 50;

type DateRange = { gte: string; lt: string };
type RecordsPage = { records: RecordVO[]; total: number; page: number; totalPages: number };

const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const offset = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  }[event.code];
  if (!offset) return undefined;
  event.preventDefault();
  const currentDay = String(
    context.over?.id ??
      context.activeNode?.closest("[data-calendar-day]")?.getAttribute("data-calendar-day") ??
      "",
  );
  const parts = currentDay.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return undefined;
  const [year, month, day] = parts as [number, number, number];
  const targetDay = dayKey(new Date(year, month - 1, day + offset));
  const target = context.droppableRects.get(targetDay);
  const card = context.collisionRect;
  if (!target || !card) return undefined;
  return {
    x: target.left + (target.width - card.width) / 2,
    y: target.top + (target.height - card.height) / 2,
  };
};

function CalendarDayCell({
  canDrop,
  children,
  day,
  inMonth,
}: {
  canDrop: boolean;
  children: ReactNode;
  day: string;
  inMonth: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: day, disabled: !canDrop });
  return (
    <div
      className={`min-h-24 border-border/50 border-r border-b p-1.5 ${
        inMonth ? "" : "bg-muted/10 text-muted-foreground/50"
      } ${isOver ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""}`}
      data-calendar-day={day}
      data-calendar-drop-target={isOver ? "true" : undefined}
      ref={setNodeRef}
    >
      {children}
    </div>
  );
}

function CalendarCard({
  canDrag,
  href,
  onOpenRecord,
  record,
}: {
  canDrag: boolean;
  href: string;
  onOpenRecord?: (record: RecordVO) => void;
  record: RecordVO;
}) {
  const messages = useCoreI18n();
  const title = getRecordTitle(record, messages);
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef } = useDraggable({
    id: record.id,
    disabled: !canDrag,
  });
  const suppressDragClick = useRef(false);
  useEffect(() => {
    if (isDragging) suppressDragClick.current = true;
  }, [isDragging]);
  // Only mouse activation covers the card. Touch and keyboard stay on the handle.
  const { onMouseDown, ...handleListeners } = listeners ?? {};
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Mouse drag delegates to the accessible handle; the link and keyboard handle retain their semantics.
    <div
      className={`flex min-w-0 items-center rounded bg-primary/10 px-0.5 text-foreground text-xs hover:bg-primary/20 ${isDragging ? "opacity-40" : ""}`}
      data-calendar-record-id={record.id}
      onMouseDown={
        canDrag
          ? (event) => {
              suppressDragClick.current = false;
              onMouseDown?.(event);
            }
          : undefined
      }
      onTouchStartCapture={() => {
        if (!isDragging) suppressDragClick.current = false;
      }}
      onKeyDownCapture={() => {
        if (!isDragging) suppressDragClick.current = false;
      }}
      onClickCapture={(event) => {
        if (isDragging || suppressDragClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressDragClick.current = false;
        }
      }}
      ref={setNodeRef}
    >
      {canDrag ? (
        <button
          {...attributes}
          {...handleListeners}
          aria-label={fmt(messages.base.calendarDragHandle, { record: title })}
          className="inline-flex size-5 shrink-0 touch-none items-center justify-center rounded cursor-grab text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          ref={setActivatorNodeRef}
          title={messages.base.calendarDragHint}
          type="button"
        >
          <GripVertical aria-hidden="true" size={12} />
        </button>
      ) : null}
      <Link
        className="min-w-0 flex-1 truncate px-1 py-0.5"
        href={href}
        title={title}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          if (
            !onOpenRecord ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onOpenRecord(record);
        }}
      >
        {title}
      </Link>
    </div>
  );
}

/**
 * Every record on one day — what a cell's "+N" opens. A day of a drained month
 * lists what is already loaded; a busy day pages through the server.
 */
function CalendarDayDialog({
  baseId,
  baseSlug,
  client,
  dateField,
  day,
  knownTotal,
  loadedRecords,
  onClose,
  onOpenRecord,
  range,
  viewId,
}: {
  baseId: string;
  baseSlug: string;
  client: BusabaseDashboardApiClient;
  dateField: BaseFieldVO;
  day: string;
  /** The count its cell already showed, until the list's own arrives. */
  knownTotal: number | undefined;
  loadedRecords: RecordVO[] | null;
  onClose: () => void;
  onOpenRecord?: (record: RecordVO) => void;
  range: DateRange | null;
  viewId: string | undefined;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const listQuery = useInfiniteQuery({
    enabled: !loadedRecords && Boolean(baseId && range),
    retry: retryRecordRead,
    getNextPageParam: (last: RecordsPage) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        dateRange: { fieldSlug: dateField.slug, gte: range?.gte ?? "", lt: range?.lt ?? "" },
        page: pageParam as number,
        pageSize: DAY_LIST_PAGE_SIZE,
        ...(viewId ? { viewId } : {}),
      }),
    queryKey: [
      "busabase",
      "calendar-day",
      baseId,
      viewId ?? "",
      dateField.slug,
      range?.gte ?? "",
      range?.lt ?? "",
      "list",
    ],
  });
  const records = loadedRecords ?? (listQuery.data?.pages ?? []).flatMap((page) => page.records);
  const total = loadedRecords
    ? loadedRecords.length
    : (listQuery.data?.pages[0]?.total ?? knownTotal);
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const label = new Date(year, month - 1, date).toLocaleDateString(locale, {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open
    >
      <DialogContent
        aria-describedby={undefined}
        className="w-[calc(100%-2rem)] sm:max-w-md"
        data-testid="calendar-day-dialog"
      >
        <DialogTitle className="text-base">{label}</DialogTitle>
        <p className="text-muted-foreground text-xs tabular-nums">
          {total === undefined
            ? messages.common.loading
            : fmt(messages.base.recordCount, { count: total, plural: total === 1 ? "" : "s" })}
        </p>
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {records.map((record) => (
            <li key={record.id}>
              <Link
                className="block truncate rounded bg-primary/10 px-2 py-1 text-foreground text-sm hover:bg-primary/20"
                href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
                onClick={(event) => {
                  if (
                    !onOpenRecord ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onClose();
                  onOpenRecord(record);
                }}
              >
                {getRecordTitle(record, messages)}
              </Link>
            </li>
          ))}
        </ul>
        {listQuery.isError || listQuery.hasNextPage ? (
          <button
            className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 px-3 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            disabled={listQuery.isFetchingNextPage}
            onClick={() =>
              void (listQuery.isError ? listQuery.refetch() : listQuery.fetchNextPage())
            }
            type="button"
          >
            {listQuery.isError
              ? messages.base.paginationRetry
              : listQuery.isFetchingNextPage
                ? messages.common.loading
                : messages.search.loadMore}
          </button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function BusaBaseCalendar({
  activeView,
  base,
  client,
  fields,
  onOpenRecord,
  onPatchRecord,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  fields: BaseFieldVO[];
  onOpenRecord?: (record: RecordVO) => void;
  onPatchRecord?: (
    record: RecordVO,
    patch: Record<string, unknown>,
  ) => Promise<{ materialized: true } | { materialized: false; changeRequestId: string }>;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const dateField = resolveDateField(base, fields, activeView?.config.dateFieldSlug);
  const baseId = base?.id ?? "";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const isAnon = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates }),
  );

  // Build a 6-week grid starting on the Sunday on/before the 1st of the month,
  // in LOCAL time — unchanged from before. `gridEnd` is the day AFTER the grid's
  // last cell, so `[gridStart, gridEnd)` is exactly the 42 rendered days.
  const firstOfMonth = new Date(cursor.year, cursor.month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 42);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }

  // The client resolves the grid boundaries to exact UTC instants — this is
  // what lets the server compare real timestamps with zero ambiguity about the
  // viewer's timezone, which it never has (see the `dateRange` doc on
  // `listRecordsPageInputSchema`, and `getCalendarDateRange` for day values).
  // The server just compares.
  const range = getCalendarDateRange(dateField?.type, gridStart, gridEnd);
  const rangeQuery = useInfiniteQuery({
    enabled: Boolean(baseId) && Boolean(dateField),
    retry: retryRecordRead,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        dateRange: {
          fieldSlug: dateField?.slug ?? "",
          gte: range.gte,
          lt: range.lt,
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
      range.gte,
      range.lt,
    ],
  });

  // A day cell's overflow badge ("+N") needs the TRUE count for every day in
  // the grid, not just the first page. A month that fits in a few pages is
  // drained and bucketed here. React Query gives no `data` for a
  // not-yet-loaded queryKey (switching months changes the key), so the grid
  // never shows a stale month's records while this runs.
  const busy = (rangeQuery.data?.pages[0]?.totalPages ?? 0) > MAX_DRAINED_PAGES;
  useEffect(() => {
    if (!busy && rangeQuery.hasNextPage && !rangeQuery.isFetchingNextPage) {
      void rangeQuery.fetchNextPage();
    }
  }, [busy, rangeQuery.hasNextPage, rangeQuery.isFetchingNextPage, rangeQuery.fetchNextPage]);
  // A busier month — tens of thousands of records in a very large Base — is
  // never read whole: each day asks for its first records and its own count.
  const dateOptions = getDateFieldOptions(dateField?.options);
  const dayRanges =
    busy && dateField
      ? days.map((day) => getCalendarDayRange(dateField.type, dateOptions, dayKey(day)))
      : [];
  const dayQueries = useQueries({
    queries: dateField
      ? dayRanges.map((dayRange) => ({
          enabled: Boolean(dayRange),
          retry: retryRecordRead,
          queryFn: () =>
            client.listRecordsPage({
              baseId,
              dateRange: {
                fieldSlug: dateField.slug,
                gte: dayRange?.gte ?? "",
                lt: dayRange?.lt ?? "",
              },
              page: 1,
              pageSize: DAY_PREVIEW_COUNT,
              ...(activeView?.id ? { viewId: activeView.id } : {}),
            }),
          queryKey: [
            "busabase",
            "calendar-day",
            baseId,
            activeView?.id ?? "",
            dateField.slug,
            dayRange?.gte ?? "",
            dayRange?.lt ?? "",
            "preview",
          ],
        }))
      : [],
  });

  if (!dateField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.calendarNoDate}</div>
    );
  }

  const rangeRecords = (rangeQuery.data?.pages ?? []).flatMap((page) => page.records);
  const records = busy
    ? dayQueries.flatMap((dayQuery) => dayQuery.data?.records ?? [])
    : rangeRecords;
  // A `read` grant on the Base may look at the calendar but not reschedule it.
  const canReschedule =
    dateField.type === "date" &&
    Boolean(onPatchRecord) &&
    !isAnon &&
    hasApiKeyLevel(permissionLevel, "changeRequest");

  const dropOnDay = async (recordId: string, targetDay: string) => {
    const record = records.find((item) => item.id === recordId);
    if (!record || !canReschedule || !onPatchRecord || pendingRecordId) return;
    const previous = record.headCommit.payload[dateField.slug];
    if (recordDayKey(dateField, previous) === targetDay) return;
    const next = rescheduledCalendarValue(dateField, previous, targetDay);
    if (!next) return;
    setDropError(null);
    setReviewRequestId(null);
    setPendingRecordId(recordId);
    try {
      const result = await onPatchRecord(record, {
        ...record.headCommit.payload,
        [dateField.slug]: next,
      });
      if (!result.materialized) setReviewRequestId(result.changeRequestId);
    } catch (error) {
      setDropError(presentCoreError(messages, locale, error, messages.shell.operationFailed));
    } finally {
      setPendingRecordId(null);
    }
  };
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";
  const activeRecord = activeId ? records.find((record) => record.id === activeId) : null;
  // True until the month's slice has been fully drained — see the effect above.
  const isLoadingMonth =
    rangeQuery.isPending ||
    (busy
      ? dayQueries.some((dayQuery) => dayQuery.isPending)
      : rangeQuery.hasNextPage || rangeQuery.isFetchingNextPage);
  // A month or day too large to read in time says so instead of looking empty.
  const monthError = rangeQuery.error ?? dayQueries.find((dayQuery) => dayQuery.error)?.error;
  const retryMonth = () => {
    if (rangeQuery.isError) void rangeQuery.refetch();
    for (const dayQuery of dayQueries) {
      if (dayQuery.isError) void dayQuery.refetch();
    }
  };

  // Bucket records by day. A calendar day stays on its own day for every
  // reader; a time-of-day value lands on the day it is in the field's zone, or
  // in the reader's own (see date-value.ts).
  const recordsByDay = new Map<string, RecordVO[]>();
  for (const record of busy ? [] : records) {
    const key = recordDayKey(dateField, record.headCommit.payload[dateField.slug]);
    if (!key) {
      continue;
    }
    if (!recordsByDay.has(key)) {
      recordsByDay.set(key, []);
    }
    recordsByDay.get(key)?.push(record);
  }

  const monthLabel = firstOfMonth.toLocaleDateString(locale, { year: "numeric", month: "long" });
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
        {pendingRecordId ? (
          <span aria-live="polite" className="text-muted-foreground text-xs">
            {messages.common.working}
          </span>
        ) : null}
      </div>
      {dropError ? (
        <div className="mb-3 text-destructive text-sm" role="alert">
          {dropError}
        </div>
      ) : null}
      {monthError ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-destructive" role="alert">
            {presentCoreError(messages, locale, monthError, messages.shell.operationFailed)}
          </span>
          <button
            className="rounded-md border border-border/70 px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
            onClick={retryMonth}
            type="button"
          >
            {messages.base.paginationRetry}
          </button>
        </div>
      ) : null}
      {reviewRequestId ? (
        <div aria-live="polite" className="mb-3 text-muted-foreground text-sm" role="status">
          {messages.form.pendingReview}{" "}
          <Link
            className="text-primary underline-offset-2 hover:underline"
            href={mergeSearchIntoHref(`/inbox/${reviewRequestId}`, currentSearch)}
          >
            {messages.inbox.title}
          </Link>
        </div>
      ) : null}

      <DndContext
        collisionDetection={(args) => {
          const hits = pointerWithin(args);
          return hits.length ? hits : rectIntersection(args);
        }}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={({ active, over }) => {
          setActiveId(null);
          if (over) void dropOnDay(String(active.id), String(over.id));
        }}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        sensors={sensors}
      >
        <div
          className="grid grid-cols-7 border-border/50 border-t border-l"
          data-calendar-dragging={activeId ? "true" : undefined}
        >
          {weekdays.map((label) => (
            <div
              className="border-border/50 border-r border-b bg-muted/20 px-2 py-1.5 text-muted-foreground text-xs"
              key={label}
            >
              {label}
            </div>
          ))}
          {days.map((day, index) => {
            const key = dayKey(day);
            const inMonth = day.getMonth() === cursor.month;
            const dayPage = busy ? dayQueries[index]?.data : undefined;
            const dayRecords = dayPage ? dayPage.records : (recordsByDay.get(key) ?? []);
            const dayTotal = dayPage ? dayPage.total : dayRecords.length;
            return (
              <CalendarDayCell
                canDrop={canReschedule && !pendingRecordId}
                day={key}
                inMonth={inMonth}
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
                  {dayRecords.slice(0, DAY_PREVIEW_COUNT).map((record) => (
                    <CalendarCard
                      canDrag={canReschedule && !pendingRecordId}
                      href={mergeSearchIntoHref(`/base/${baseSlug}/${record.id}`, currentSearch)}
                      key={record.id}
                      onOpenRecord={onOpenRecord}
                      record={record}
                    />
                  ))}
                  {dayTotal > DAY_PREVIEW_COUNT ? (
                    <button
                      aria-label={fmt(messages.base.recordCount, {
                        count: dayTotal,
                        plural: dayTotal === 1 ? "" : "s",
                      })}
                      className="self-start rounded px-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
                      onClick={() => setOpenDay(key)}
                      type="button"
                    >
                      +{dayTotal - Math.min(dayRecords.length, DAY_PREVIEW_COUNT)}
                    </button>
                  ) : null}
                </div>
              </CalendarDayCell>
            );
          })}
        </div>
        {openDay ? (
          <CalendarDayDialog
            baseId={baseId}
            baseSlug={baseSlug}
            client={client}
            dateField={dateField}
            day={openDay}
            knownTotal={
              busy
                ? dayQueries[days.findIndex((day) => dayKey(day) === openDay)]?.data?.total
                : undefined
            }
            loadedRecords={busy ? null : (recordsByDay.get(openDay) ?? [])}
            onClose={() => setOpenDay(null)}
            onOpenRecord={onOpenRecord}
            range={getCalendarDayRange(dateField.type, dateOptions, openDay)}
            viewId={activeView?.id}
          />
        ) : null}
        <DragOverlay>
          {activeRecord ? (
            <div className="rounded border border-primary bg-card px-2 py-1 text-foreground text-xs shadow-md">
              {getRecordTitle(activeRecord, messages)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
