import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BaseFieldVO, BaseVO, GanttScale, RecordVO, ViewVO } from "busabase-contract/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError, VIEW_TOO_LARGE_MESSAGE } from "../../../i18n/localize-error";
import { recordFindErrorMessage, recordFindMessages } from "../../../i18n/record-find";
import {
  calendarDayToLocalDate,
  fromDateTimeInputValue,
  getCalendarDayRange,
  getDateFieldCalendarDay,
  getDateFieldOptions,
  toDateTimeInputValue,
} from "../../base/utils/date-value";
import { getRecordTitle } from "../helpers/change-request";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { retryRecordRead } from "../helpers/query-state";
import type { RecordCollectionStatus } from "../helpers/record-collection-status";
import { useSourceViewSlug } from "../helpers/source-view-context";
import { withSourceView } from "../helpers/source-view-url";
import {
  readTimelineState,
  type TimelineState,
  writeTimelineState,
} from "../helpers/timeline-state-url";
import type { RecordFindControl } from "../hooks/use-record-find";
import { useDashboardOrpc } from "../orpc-context";
import { useIsAnonymousVisitor } from "../visitor-context";
import { DragReviewNotice } from "./base-kanban";
import { useWorkspacePermissionLevel } from "./split-submit-button";

const DAY_MS = 86_400_000;
// Pixels per day per scale — month packs tighter, week spreads out.
const DAY_PX: Record<GanttScale, number> = { month: 5, week: 22 };
// A one-day record is only 5px wide in month mode and 22px in week mode.
// Keep its real start aligned to the axis, while reserving enough visual room
// for its label and resize affordances.
const MIN_BAR_RENDER_WIDTH = 72;
const TITLE_COL_PX = 200;
// Rows per request. The timeline reads the view a page at a time, so a Base
// of any size opens on its first rows; an ordinary project — up to
// GANTT_AUTO_PAGES pages — still shows every row without a click.
const GANTT_PAGE_SIZE = 100;
const GANTT_AUTO_PAGES = 5;
// Up to this many rows the timeline draws the whole view on one axis, as it
// always has. A larger view is read one period at a time: the rows whose span
// overlaps it, the way Calendar reads one month.
const GANTT_WHOLE_VIEW_ROWS = GANTT_PAGE_SIZE * GANTT_AUTO_PAGES;
// A period fills about a screen at either scale: 6 months at 5 px a day,
// 6 weeks at 22 px a day.
const PERIOD_LENGTH: Record<GanttScale, number> = { month: 6, week: 6 };

const dateFieldTypes = ["date", "created_time", "updated_time"] as const;

/** Resolve the start/end date fields. Honors config; else first two date fields. */
export const resolveGanttFields = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  startSlug: string | null | undefined,
  endSlug: string | null | undefined,
): { start: BaseFieldVO | null; end: BaseFieldVO | null } => {
  const dateFields = (base?.fields ?? fields).filter((f) =>
    (dateFieldTypes as readonly string[]).includes(f.type),
  );
  const start = startSlug
    ? (dateFields.find((f) => f.slug === startSlug) ?? null)
    : (dateFields[0] ?? null);
  const end = endSlug
    ? (dateFields.find((f) => f.slug === endSlug) ?? null)
    : (dateFields.find((f) => f.slug !== start?.slug) ?? null);
  return { start, end };
};

// Local-midnight Date for the day a value sits on, or null. A `date` field's
// calendar day is never shifted by the reader's zone (see date-value.ts);
// `created_time` / `updated_time` are instants read in local time.
const parseDay = (field: BaseFieldVO, value: unknown): Date | null => {
  if (field.type === "date") {
    const day = getDateFieldCalendarDay(value, getDateFieldOptions(field.options));
    return day ? calendarDayToLocalDate(day) : null;
  }
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/**
 * The value to store after a bar is dragged onto `day`. A day field stores
 * `YYYY-MM-DD`; a time-of-day field keeps its time of day (read in the field's
 * zone, else the reader's) and moves to the new day in that same zone.
 */
const draggedDayValue = (field: BaseFieldVO, previous: unknown, day: Date): string => {
  const options = getDateFieldOptions(field.options);
  if (field.type !== "date" || !options.includeTime) {
    return toYMD(day);
  }
  const zone = options.timezone || undefined;
  const time = toDateTimeInputValue(previous, zone).slice(11) || "00:00";
  return fromDateTimeInputValue(`${toYMD(day)}T${time}`, zone) ?? toYMD(day);
};

/** The first local day of the period that holds `day`: a month's 1st, or a week's Sunday. */
const periodStartOf = (day: Date, scale: GanttScale) =>
  scale === "month"
    ? new Date(day.getFullYear(), day.getMonth(), 1)
    : new Date(day.getFullYear(), day.getMonth(), day.getDate() - day.getDay());

/** The first day of the period `steps` periods away from the one starting at `start`. */
const shiftPeriod = (start: Date, scale: GanttScale, steps: number) =>
  scale === "month"
    ? new Date(start.getFullYear(), start.getMonth() + PERIOD_LENGTH.month * steps, 1)
    : addDays(start, PERIOD_LENGTH.week * 7 * steps);

type DragMode = "move" | "resize-start" | "resize-end";
type DragState = {
  recordId: string;
  mode: DragMode;
  originX: number;
  deltaDays: number;
  scope: string;
};

type Row = { record: RecordVO; start: Date; end: Date };

export function BusaBaseGantt({
  activeView,
  base,
  client,
  fields,
  onCollectionStatusChange,
  onPatchRecord,
  queryScope,
  recordFind,
}: {
  activeView: ViewVO | null;
  base: BaseVO | null;
  client: BusabaseDashboardApiClient;
  fields: BaseFieldVO[];
  onCollectionStatusChange?: (status: RecordCollectionStatus) => void;
  /** Reschedule: patch start/end on a record and auto-merge, no navigation. */
  onPatchRecord?: (
    record: RecordVO,
    patch: Record<string, unknown>,
  ) => Promise<{ materialized: true } | { materialized: false; changeRequestId: string }>;
  queryScope?: string;
  recordFind?: RecordFindControl;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const currentSearch = useSearch();
  const [location, navigate] = useLocation();
  const sourceViewSlug = useSourceViewSlug();
  const isAnon = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const [drag, setDrag] = useState<DragState | null>(null);
  const liveDragRef = useRef<DragState | null>(null);
  const finishDragRef = useRef<((finished: DragState) => void) | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [reviewRequestId, setReviewRequestId] = useState<string | null>(null);
  const baseId = base?.id ?? "";
  const stateScope = `${baseId}:${activeView?.id ?? "all"}`;
  const savedState = readTimelineState(currentSearch, stateScope);
  const savedScale = activeView?.config.ganttScale ?? "month";
  const stateKey = JSON.stringify([stateScope, savedState, savedScale]);
  const initialState: TimelineState = savedState ?? {
    scale: savedScale,
    start: toYMD(periodStartOf(new Date(), savedScale)),
  };
  const [browsing, setBrowsing] = useState(() => ({ key: stateKey, value: initialState }));
  if (browsing.key !== stateKey) setBrowsing({ key: stateKey, value: initialState });
  const currentState = browsing.key === stateKey ? browsing.value : initialState;
  const scale = currentState.scale;
  const [periodYear, periodMonth, periodDay] = currentState.start.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const periodStart = new Date(periodYear, periodMonth - 1, periodDay);
  const updateBrowsing = (next: TimelineState) => {
    setBrowsing({ key: stateKey, value: next });
    navigate(`${location}?${writeTimelineState(currentSearch, next, stateScope)}`, {
      replace: true,
    });
  };
  const dayPx = DAY_PX[scale];
  const { start: startField, end: endField } = resolveGanttFields(
    base,
    fields,
    activeView?.config.startFieldSlug,
    activeView?.config.endFieldSlug,
  );
  const orpc = useDashboardOrpc();
  const findMessages = recordFindMessages[locale];
  const hasDateFields = Boolean(startField && endField);
  const viewScope = JSON.stringify([
    baseId,
    activeView?.id,
    activeView?.config.filters,
    activeView?.config.sorts,
    startField,
    endField,
  ]);
  const scope = queryScope ?? JSON.stringify([viewScope, currentState, recordFind?.input]);
  // Display mode follows the unfiltered saved view, never the keyword's match
  // count. A large view narrowed to one match must keep its period and bounds.
  const modeQuery = useQuery({
    enabled: Boolean(baseId) && hasDateFields,
    retry: recordFind?.hasQuery ? false : retryRecordRead,
    queryFn: () =>
      client.listRecordsPage({
        baseId,
        page: 1,
        pageSize: 1,
        totalLimit: GANTT_WHOLE_VIEW_ROWS + 1,
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    queryKey: [...(orpc?.records.listPage.key() ?? ["busabase"]), "gantt-mode", viewScope],
  });
  const modeResolved = Boolean(modeQuery.data);
  const periodMode = Boolean(
    modeQuery.data && (modeQuery.data.totalCapped || modeQuery.data.total > GANTT_WHOLE_VIEW_ROWS),
  );
  const rowsQuery = useInfiniteQuery({
    enabled: modeResolved && !periodMode && hasDateFields,
    retry: recordFind?.hasQuery ? false : retryRecordRead,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        find: recordFind?.input,
        page: pageParam as number,
        pageSize: GANTT_PAGE_SIZE,
        totalLimit: GANTT_WHOLE_VIEW_ROWS + 1,
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    // Under the canonical records prefix, so live-sync and edits refresh it.
    queryKey: [
      ...(orpc?.records.listPage.key() ?? ["busabase"]),
      "gantt-rows",
      viewScope,
      recordFind?.input,
    ],
  });

  // A period [periodStart, periodEnd) of local days. A row overlaps it when it
  // starts before the period ends and ends on or after its first day — in each
  // field's own day convention (see getCalendarDayRange).
  const periodEnd = shiftPeriod(periodStart, scale, 1);
  const startsBefore =
    startField &&
    getCalendarDayRange(startField.type, getDateFieldOptions(startField.options), toYMD(periodEnd))
      ?.gte;
  const endsFrom =
    endField &&
    getCalendarDayRange(endField.type, getDateFieldOptions(endField.options), toYMD(periodStart))
      ?.gte;
  const periodQuery = useInfiniteQuery({
    enabled: periodMode && Boolean(startField && endField && startsBefore && endsFrom),
    retry: recordFind?.hasQuery ? false : retryRecordRead,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.listRecordsPage({
        baseId,
        find: recordFind?.input,
        page: pageParam as number,
        pageSize: GANTT_PAGE_SIZE,
        // Only whether there is a next page: a period of a huge view is itself huge.
        totalLimit: (pageParam as number) * GANTT_PAGE_SIZE + 1,
        dateRanges: [
          { fieldSlug: startField?.slug ?? "", lt: startsBefore ?? undefined },
          { fieldSlug: endField?.slug ?? "", gte: endsFrom ?? undefined },
        ],
        // Order the schedule before paging, so "Load more" continues from the
        // dates already shown. An explicitly saved view sort still wins.
        ...(!activeView?.config.sorts.length && startField
          ? { sort: { fieldSlug: startField.slug, fieldType: "date", direction: "asc" as const } }
          : {}),
        ...(activeView?.id ? { viewId: activeView.id } : {}),
      }),
    queryKey: [
      ...(orpc?.records.listPage.key() ?? ["busabase"]),
      "gantt-period",
      viewScope,
      startsBefore ?? "",
      endsFrom ?? "",
      recordFind?.input,
    ],
  });
  const activeQuery = periodMode ? periodQuery : rowsQuery;
  const loadedPages = activeQuery.data?.pages.length ?? 0;
  useEffect(() => {
    if (
      // A long schedule uses a global date sort. Start with one page instead
      // of immediately running five potentially expensive ordered reads.
      !periodMode &&
      !recordFind?.isPending &&
      !modeQuery.isError &&
      !activeQuery.isError &&
      loadedPages > 0 &&
      loadedPages < GANTT_AUTO_PAGES &&
      activeQuery.hasNextPage &&
      !activeQuery.isFetchingNextPage
    ) {
      void activeQuery.fetchNextPage();
    }
  }, [
    periodMode,
    recordFind?.isPending,
    modeQuery.isError,
    activeQuery.isError,
    loadedPages,
    activeQuery.hasNextPage,
    activeQuery.isFetchingNextPage,
    activeQuery.fetchNextPage,
  ]);
  const records = recordFind?.isPending
    ? []
    : (activeQuery.data?.pages ?? []).flatMap((page) => page.records);
  const lastPage = activeQuery.data?.pages.at(-1);
  // A count that stopped early says "at least what is shown".
  const total = lastPage?.totalCapped ? `${records.length}+` : `${lastPage?.total ?? 0}`;
  const baseSlug = base?.slug ?? records[0]?.base.slug ?? "";
  const readError = modeQuery.error ?? (modeResolved ? activeQuery.error : null);
  const isFetching = Boolean(
    hasDateFields &&
      (recordFind?.isPending ||
        modeQuery.isFetching ||
        (!readError &&
          (!modeResolved ||
            activeQuery.isFetching ||
            (!periodMode && loadedPages < GANTT_AUTO_PAGES && activeQuery.hasNextPage)))),
  );
  // Rows still arriving for the current scope. A background refresh of rows
  // already on screen is not loading: it must neither drop a gesture the
  // reader is holding nor flash a status line over the chart.
  const isLoading = Boolean(
    hasDateFields &&
      (recordFind?.isPending ||
        (!readError &&
          (!modeResolved ||
            activeQuery.isLoading ||
            activeQuery.isFetchingNextPage ||
            (!periodMode && loadedPages < GANTT_AUTO_PAGES && activeQuery.hasNextPage)))),
  );
  const collectionTotal =
    !hasDateFields || readError || !modeResolved
      ? undefined
      : lastPage?.totalCapped
        ? records.length
        : lastPage?.total;
  const collectionTotalCapped = lastPage?.totalCapped;
  useEffect(() => {
    onCollectionStatusChange?.({
      scope,
      total: collectionTotal,
      totalCapped: collectionTotalCapped,
      isFetching,
      isError: Boolean(readError),
    });
  }, [
    scope,
    collectionTotal,
    collectionTotalCapped,
    isFetching,
    readError,
    onCollectionStatusChange,
  ]);
  const interactionScope = JSON.stringify([
    scope,
    viewScope,
    scale,
    currentState.start,
    recordFind?.input,
    recordFind?.isPending,
    periodMode,
  ]);
  useEffect(() => {
    if (liveDragRef.current?.scope !== interactionScope) liveDragRef.current = null;
    setDrag((current) => (current?.scope === interactionScope ? current : null));
  }, [interactionScope]);

  // Window listeners drive the active drag; committed on mouse-up.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const current = liveDragRef.current;
      if (!current) return;
      const next = {
        ...current,
        deltaDays: Math.round((event.clientX - current.originX) / dayPx),
      };
      // A quick move and release may happen before React paints the preview.
      // Keep the gesture authoritative synchronously; state is only its paint.
      liveDragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const finished = liveDragRef.current;
      if (!finished) return;
      // A clipped edge is at the track boundary. Releasing after dragging it
      // out of the track still finishes the gesture.
      liveDragRef.current = null;
      finishDragRef.current?.(finished);
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dayPx]);

  if (!startField || !endField) {
    return (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.base.ganttNoDates}</div>
    );
  }
  if (!modeResolved) {
    return modeQuery.error ? (
      <div className="flex flex-wrap items-center gap-2 px-2 py-6 text-sm">
        <span className="text-destructive" role="alert">
          {presentCoreError(messages, locale, modeQuery.error, messages.shell.operationFailed)}
        </span>
        <button
          className="underline underline-offset-2"
          onClick={() => void modeQuery.refetch()}
          type="button"
        >
          {messages.base.paginationRetry}
        </button>
      </div>
    ) : (
      <div className="px-2 py-6 text-muted-foreground text-sm">{messages.common.loading}</div>
    );
  }

  // How much of the view is on screen, and the way to the rest.
  const loadFooter =
    !recordFind?.isPending && (readError || activeQuery.hasNextPage) ? (
      <div className="sticky left-0 flex flex-wrap items-center gap-3 px-2 py-3 text-muted-foreground text-xs">
        <span className="tabular-nums" role={readError ? "alert" : undefined}>
          {readError
            ? (recordFindErrorMessage(locale, readError) ??
              presentCoreError(messages, locale, readError, messages.shell.operationFailed))
            : fmt(messages.base.paginationRange, { from: 1, to: records.length, total })}
        </span>
        <button
          className="inline-flex h-8 items-center rounded-md border border-border/70 px-3 font-medium text-xs transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          disabled={modeQuery.isFetching || activeQuery.isFetching || recordFind?.isPending}
          onClick={() =>
            void (modeQuery.error
              ? modeQuery.refetch()
              : activeQuery.isError && !activeQuery.isFetchNextPageError
                ? activeQuery.refetch()
                : activeQuery.fetchNextPage())
          }
          type="button"
        >
          {readError
            ? messages.base.paginationRetry
            : activeQuery.isFetchingNextPage
              ? messages.common.loading
              : messages.search.loadMore}
        </button>
      </div>
    ) : null;

  const rows: Row[] = [];
  for (const record of records) {
    const start = parseDay(startField, record.headCommit.payload[startField.slug]);
    const end = parseDay(endField, record.headCommit.payload[endField.slug]);
    if (start && end && end.getTime() >= start.getTime()) {
      rows.push({ record, start, end });
    }
  }

  // Axis range: the period itself, or whole months around the data. A bar
  // reaching past the period is cut at its edge.
  const firstStart = rows[0]?.start ?? periodStart;
  const lastEnd = rows[0]?.end ?? periodStart;
  const minStart = rows.reduce((m, r) => (r.start < m ? r.start : m), firstStart);
  const maxEnd = rows.reduce((m, r) => (r.end > m ? r.end : m), lastEnd);
  const rangeStart = periodMode
    ? periodStart
    : new Date(minStart.getFullYear(), minStart.getMonth(), 1);
  const rangeEnd = periodMode
    ? addDays(periodEnd, -1)
    : new Date(maxEnd.getFullYear(), maxEnd.getMonth() + 1, 0);
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1;
  const periodLabelFormat: Intl.DateTimeFormatOptions =
    scale === "month"
      ? { year: "numeric", month: "short" }
      : { year: "numeric", month: "short", day: "numeric" };
  const timelineWidth = totalDays * dayPx;

  // Month header segments across the range.
  const months: Array<{ label: string; left: number; width: number }> = [];
  let cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const clippedEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    months.push({
      label: monthStart.toLocaleDateString(locale, { year: "numeric", month: "short" }),
      left: daysBetween(rangeStart, monthStart) * dayPx,
      width: (daysBetween(monthStart, clippedEnd) + 1) * dayPx,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  // A `read` grant on the Base may look at the timeline but not reschedule it.
  const canDrag =
    Boolean(onPatchRecord) &&
    !isAnon &&
    !recordFind?.isPending &&
    !isLoading &&
    !readError &&
    hasApiKeyLevel(permissionLevel, "changeRequest");

  // Apply the in-flight drag delta to a row for live preview.
  const previewDates = (row: Row, gesture = drag): { start: Date; end: Date } => {
    if (!gesture || gesture.recordId !== row.record.id || gesture.deltaDays === 0) {
      return { start: row.start, end: row.end };
    }
    if (gesture.mode === "move") {
      return {
        start: addDays(row.start, gesture.deltaDays),
        end: addDays(row.end, gesture.deltaDays),
      };
    }
    if (gesture.mode === "resize-start") {
      const next = addDays(row.start, gesture.deltaDays);
      return { start: next > row.end ? row.end : next, end: row.end };
    }
    const next = addDays(row.end, gesture.deltaDays);
    return { start: row.start, end: next < row.start ? row.start : next };
  };

  const commitDrag = (row: Row, gesture: DragState) => {
    if (
      gesture.recordId !== row.record.id ||
      gesture.deltaDays === 0 ||
      !onPatchRecord ||
      gesture.scope !== interactionScope ||
      !canDrag
    ) {
      return;
    }
    const { start, end } = previewDates(row, gesture);
    const patch: Record<string, unknown> = {};
    if (start.getTime() !== row.start.getTime()) {
      patch[startField.slug] = draggedDayValue(
        startField,
        row.record.headCommit.payload[startField.slug],
        start,
      );
    }
    if (end.getTime() !== row.end.getTime()) {
      patch[endField.slug] = draggedDayValue(
        endField,
        row.record.headCommit.payload[endField.slug],
        end,
      );
    }
    if (Object.keys(patch).length > 0) {
      void submitPatch(row.record, { ...row.record.headCommit.payload, ...patch });
    }
  };
  finishDragRef.current = (finished) => {
    const row = rows.find((candidate) => candidate.record.id === finished.recordId);
    if (row) commitDrag(row, finished);
  };

  const submitPatch = async (record: RecordVO, fields: Record<string, unknown>) => {
    if (!onPatchRecord) return;
    setDropError(null);
    setReviewRequestId(null);
    try {
      const result = await onPatchRecord(record, fields);
      if (!result.materialized) setReviewRequestId(result.changeRequestId);
    } catch (error) {
      setDropError(presentCoreError(messages, locale, error, messages.shell.operationFailed));
    }
  };

  const beginDrag = (event: React.MouseEvent, row: Row) => {
    if (!canDrag || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const edge = 8;
    const resizeEdge =
      event.target instanceof Element
        ? event.target.closest("[data-resize-edge]")?.getAttribute("data-resize-edge")
        : null;
    const mode: DragMode =
      resizeEdge === "start" || (!resizeEdge && offsetX <= edge)
        ? "resize-start"
        : resizeEdge === "end" || (!resizeEdge && offsetX >= rect.width - edge)
          ? "resize-end"
          : "move";
    const next = {
      recordId: row.record.id,
      mode,
      originX: event.clientX,
      deltaDays: 0,
      scope: interactionScope,
    };
    liveDragRef.current = next;
    setDrag(next);
  };

  return (
    <div className="overflow-x-auto pb-5">
      <div className="sticky left-0 flex flex-wrap items-center gap-2 pb-2">
        <span className="text-muted-foreground text-xs">{messages.base.ganttScale}</span>
        <div className="flex rounded-md bg-muted/60 p-0.5 text-xs">
          {(["week", "month"] as const).map((option) => (
            <button
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                scale === option
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={option}
              onClick={() => {
                updateBrowsing({
                  scale: option,
                  start: toYMD(periodStartOf(periodStart, option)),
                });
              }}
              type="button"
            >
              {option === "week" ? messages.base.ganttWeek : messages.base.ganttMonth}
            </button>
          ))}
        </div>
        {periodMode ? (
          <div className="flex items-center gap-2" data-testid="gantt-period">
            <button
              aria-label={messages.base.ganttEarlier}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() =>
                updateBrowsing({ scale, start: toYMD(shiftPeriod(periodStart, scale, -1)) })
              }
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              aria-label={messages.base.ganttLater}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() =>
                updateBrowsing({ scale, start: toYMD(shiftPeriod(periodStart, scale, 1)) })
              }
              type="button"
            >
              <ChevronRight size={15} />
            </button>
            <span className="font-semibold text-sm tabular-nums">
              {periodStart.toLocaleDateString(locale, periodLabelFormat)} –{" "}
              {addDays(periodEnd, -1).toLocaleDateString(locale, periodLabelFormat)}
            </span>
            <button
              className="ml-1 rounded-md border border-border/70 bg-card px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
              onClick={() =>
                updateBrowsing({ scale, start: toYMD(periodStartOf(new Date(), scale)) })
              }
              type="button"
            >
              {messages.base.calendarToday}
            </button>
            {activeQuery.isPending ? (
              <span className="text-muted-foreground text-xs">{messages.common.loading}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {recordFind ? (
        <p
          className="sticky left-0 mb-3 text-muted-foreground text-xs"
          data-testid="gantt-find-scope"
        >
          {periodMode ? findMessages.timelinePeriodScope : findMessages.timelineWholeScope}
        </p>
      ) : null}
      {isLoading ? (
        <div
          aria-live="polite"
          className="sticky left-0 mb-3 text-muted-foreground text-sm"
          role="status"
        >
          {recordFind?.hasQuery || recordFind?.isPending
            ? findMessages.searching
            : messages.common.loading}
        </div>
      ) : null}
      {!isLoading && !readError && recordFind?.hasQuery && collectionTotal === 0 ? (
        <div
          className="sticky left-0 mb-3 flex flex-wrap items-center gap-2 text-muted-foreground text-sm"
          data-testid="base-record-find-empty"
          role="status"
        >
          {periodMode ? findMessages.timelinePeriodEmpty : findMessages.empty}
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={recordFind.clear}
            type="button"
          >
            {findMessages.clear}
          </button>
        </div>
      ) : null}
      {!isLoading && !readError && records.length > rows.length && recordFind?.hasQuery ? (
        <p
          className="sticky left-0 mb-3 text-muted-foreground text-sm"
          data-testid="gantt-find-invalid-dates"
          role="status"
        >
          {fmt(findMessages.timelineInvalidDates, { count: records.length - rows.length })}
        </p>
      ) : null}
      <DragReviewNotice
        currentSearch={currentSearch}
        error={dropError}
        reviewRequestId={reviewRequestId}
      />

      <div style={{ width: TITLE_COL_PX + timelineWidth }}>
        {/* Month axis header */}
        <div className="flex border-border/50 border-b">
          <div className="shrink-0 border-border/50 border-r" style={{ width: TITLE_COL_PX }} />
          <div className="relative" style={{ width: timelineWidth, height: 28 }}>
            {months.map((m) => (
              <div
                className="absolute top-0 truncate border-border/40 border-l px-1.5 py-1 text-muted-foreground text-xs"
                key={m.label}
                style={{ left: m.left, width: m.width }}
              >
                {m.label}
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        {rows.map((row) => {
          const { start, end } = previewDates(row);
          const left = daysBetween(rangeStart, start) * dayPx;
          const durationWidth = Math.max((daysBetween(start, end) + 1) * dayPx, dayPx);
          const width = Math.max(durationWidth, MIN_BAR_RENDER_WIDTH);
          // Draw the visible intersection itself, rather than placing an
          // enormous bar outside the track. Its label and resize edges remain
          // reachable even when the real dates are outside this period. Drag
          // deltas still apply to those real dates, never to the clipped edge.
          const visibleLeft = Math.max(0, Math.min(timelineWidth, left));
          const visibleWidth = Math.max(0, Math.min(timelineWidth, left + width) - visibleLeft);
          const active = drag?.recordId === row.record.id;
          return (
            <div className="flex items-center border-border/30 border-b" key={row.record.id}>
              <div
                className="shrink-0 truncate border-border/50 border-r px-2 py-2"
                style={{ width: TITLE_COL_PX }}
              >
                <Link
                  className="truncate font-medium text-foreground text-sm hover:underline"
                  href={mergeSearchIntoHref(
                    withSourceView(`/base/${baseSlug}/${row.record.id}`, sourceViewSlug),
                    currentSearch,
                  )}
                  title={getRecordTitle(row.record, messages)}
                >
                  {getRecordTitle(row.record, messages)}
                </Link>
              </div>
              <div
                className="relative overflow-hidden py-1.5"
                style={{ width: timelineWidth, height: 32 }}
              >
                {/* biome-ignore lint/a11y/noStaticElementInteractions: gantt bar is a mouse drag handle; the row title Link is the keyboard-accessible affordance */}
                <div
                  className={`absolute top-1.5 flex h-5 items-center rounded bg-primary/80 text-primary-foreground text-xs shadow-sm ${
                    canDrag ? "cursor-grab active:cursor-grabbing" : ""
                  } ${active ? "ring-2 ring-primary" : ""} ${visibleWidth === 0 ? "invisible" : ""}`}
                  onMouseDown={canDrag ? (event) => beginDrag(event, row) : undefined}
                  data-testid={`gantt-bar-${row.record.id}`}
                  style={{ left: visibleLeft, width: visibleWidth }}
                  title={`${toYMD(start)} → ${toYMD(end)}`}
                >
                  {canDrag ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l border-primary-foreground/50 border-l-2"
                      data-resize-edge="start"
                      data-testid={`gantt-resize-start-${row.record.id}`}
                    />
                  ) : null}
                  <span className={`truncate ${canDrag ? "px-2.5" : "px-1.5"}`}>
                    {getRecordTitle(row.record, messages)}
                  </span>
                  {canDrag ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r border-primary-foreground/50 border-r-2"
                      data-resize-edge="end"
                      data-testid={`gantt-resize-end-${row.record.id}`}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!isLoading &&
      !readError &&
      rows.length === 0 &&
      !recordFind?.hasQuery &&
      !recordFind?.isPending ? (
        <div className="sticky left-0 px-2 py-6 text-muted-foreground text-sm">
          {periodMode ? messages.base.ganttEmptyPeriod : messages.base.ganttNoDates}
        </div>
      ) : null}
      {loadFooter}
      {!recordFind?.isPending && !activeQuery.hasNextPage && lastPage?.pagesCapped ? (
        <p className="sticky left-0 px-2 py-3 text-muted-foreground text-sm" role="status">
          {presentCoreError(
            messages,
            locale,
            new Error(VIEW_TOO_LARGE_MESSAGE),
            messages.shell.operationFailed,
          )}
        </p>
      ) : null}
    </div>
  );
}
