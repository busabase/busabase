import { skipToken, useInfiniteQuery, useQueries } from "@tanstack/react-query";
import type { RecordVO } from "busabase-contract/types";
import {
  getCalendarDateRange,
  getCalendarDayRange,
  getDateFieldOptions,
} from "busabase-core/base/date-value";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { resolveDateField } from "busabase-core/domains/base/utils/view-field-resolution";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeBottomSheet, NativeInlineError } from "~/components/native-screen";
import { useMobileQueryRecovery } from "~/domains/workspace/hooks/use-mobile-query-recovery";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";
import { buildMonthGrid, dayKey, recordDayKey, shiftMonth } from "../utils/calendar-grid";

/** Records per request within the current month's slice (server max is 100). */
const RANGE_PAGE_SIZE = 100;
const MAX_MONTH_PAGES = 10;
const PREVIEW_TOTAL_LIMIT = RANGE_PAGE_SIZE * MAX_MONTH_PAGES;
const MAX_VISIBLE_PER_DAY = 4;
const DAY_PAGE_SIZE = 50;
const MAX_DAY_RECORDS = 100_000;

// These answers cannot change on an automatic retry. A manual retry remains
// available after the reader changes the filter or the server recovers.
const retryCalendarRead = (failureCount: number, error: unknown) =>
  !(
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "TIMEOUT" || error.code === "BAD_REQUEST")
  ) && failureCount < 3;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  base: BaseDetailController["base"];
  activeView: BaseDetailController["activeView"];
  fields: BaseDetailController["previewFields"];
  onOpenRecord: (recordId: string) => void;
}

/** Small months read at most 1,000 records; busy months use bounded day previews. */
export function BaseCalendarView({ base, activeView, fields, onOpenRecord }: Props) {
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const dateField = resolveDateField(base, fields, activeView?.config.dateFieldSlug);
  const baseId = base?.id ?? "";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [openDay, setOpenDay] = useState<string | null>(null);

  const { gridStart, gridEnd, days } = buildMonthGrid(cursor.year, cursor.month);
  // Same bounds as web: a `date` field's day values sit at UTC midnight.
  const range = getCalendarDateRange(dateField?.type, gridStart, gridEnd);

  const rangeQueryKey = [
    buda?.scopeKey ?? "no-connection",
    "base-calendar-range",
    baseId,
    activeView?.id ?? "",
    dateField?.slug ?? "",
    range.gte,
    range.lt,
  ];
  const rangeQuery = useInfiniteQuery({
    queryKey: rangeQueryKey,
    retry: retryCalendarRead,
    queryFn:
      buda && baseId && dateField
        ? ({ pageParam }: { pageParam: number }) =>
            buda.client.records.listPage({
              baseId,
              dateRange: {
                fieldSlug: dateField.slug,
                gte: range.gte,
                lt: range.lt,
              },
              page: pageParam,
              pageSize: RANGE_PAGE_SIZE,
              totalLimit: PREVIEW_TOTAL_LIMIT,
              ...(activeView?.id ? { viewId: activeView.id } : {}),
            })
        : skipToken,
    initialPageParam: 1,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
  });
  const busy =
    rangeQuery.data?.pages[0]?.totalCapped === true ||
    (rangeQuery.data?.pages[0]?.totalPages ?? 0) > MAX_MONTH_PAGES;
  const dateOptions = getDateFieldOptions(dateField?.options);
  const dayRanges =
    busy && dateField
      ? days.map((day) => getCalendarDayRange(dateField.type, dateOptions, dayKey(day)))
      : [];
  // Keep the existing prefix: pull-to-refresh, reconnect and visible-route
  // recovery invalidate both the probe and the currently displayed previews.
  const dayQueryKeys = dayRanges.map((dayRange) => [
    buda?.scopeKey ?? "no-connection",
    "base-calendar-range",
    baseId,
    activeView?.id ?? "",
    dateField?.slug ?? "",
    dayRange?.gte ?? "",
    dayRange?.lt ?? "",
    "preview",
  ]);
  const routeActive = useMobileQueryRecovery(
    buda && baseId && dateField ? [rangeQueryKey, ...dayQueryKeys] : [],
  );
  const dayQueries = useQueries({
    queries: dayRanges.map((dayRange, index) => ({
      queryKey: dayQueryKeys[index] ?? [],
      enabled: routeActive,
      retry: retryCalendarRead,
      queryFn:
        buda && baseId && dateField && dayRange
          ? () =>
              buda.client.records.listPage({
                baseId,
                dateRange: { fieldSlug: dateField.slug, ...dayRange },
                page: 1,
                pageSize: MAX_VISIBLE_PER_DAY,
                totalLimit: PREVIEW_TOTAL_LIMIT,
                ...(activeView?.id ? { viewId: activeView.id } : {}),
              })
          : skipToken,
    })),
  });
  // Never drain an unbounded month, even when an older server ignores
  // totalLimit. Inactive routes also stop asking for the next page.
  useEffect(() => {
    if (
      routeActive &&
      !busy &&
      (rangeQuery.data?.pages.length ?? 0) < MAX_MONTH_PAGES &&
      rangeQuery.hasNextPage &&
      !rangeQuery.isFetching &&
      !rangeQuery.isError
    ) {
      void rangeQuery.fetchNextPage();
    }
  }, [
    routeActive,
    busy,
    rangeQuery.data?.pages.length,
    rangeQuery.hasNextPage,
    rangeQuery.isFetching,
    rangeQuery.isError,
    rangeQuery.fetchNextPage,
  ]);
  // A day belongs to one view/month. Do not leave a hidden old day's list
  // active after navigating to a different month, Base or saved view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these context keys intentionally reset the selection, like SearchView resets page state on its serialized query.
  useEffect(() => setOpenDay(null), [baseId, activeView?.id, cursor.year, cursor.month]);

  if (!dateField) {
    return (
      <Text style={[typography.body, styles.emptyText, { color: tokens.mutedForeground }]}>
        Add a date field to place records on the calendar.
      </Text>
    );
  }

  const records = busy ? [] : (rangeQuery.data?.pages ?? []).flatMap((page) => page.records);
  const isLoadingMonth =
    rangeQuery.isPending ||
    (busy
      ? dayQueries.some((query) => query.isPending)
      : rangeQuery.hasNextPage || rangeQuery.isFetchingNextPage);
  const monthError = rangeQuery.error ?? dayQueries.find((query) => query.error)?.error;
  const retryMonth = () => {
    if (rangeQuery.isError) void rangeQuery.refetch();
    for (const query of dayQueries) if (query.isError) void query.refetch();
  };
  const recordsByDay = new Map<string, RecordVO[]>();
  for (const record of records) {
    const key = recordDayKey(record.headCommit.payload[dateField.slug], dateOptions);
    if (!key) continue;
    const bucket = recordsByDay.get(key);
    if (bucket) bucket.push(record);
    else recordsByDay.set(key, [record]);
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
  const todayKey = dayKey(today);

  return (
    <View style={styles.container}>
      {monthError ? (
        <View style={styles.error}>
          <NativeInlineError
            message={monthError instanceof Error ? monthError.message : "Couldn't load this month."}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry month"
            onPress={retryMonth}
          >
            <Text style={[typography.small, { color: tokens.foreground }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.nav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={mobile.hitSlop}
          style={[styles.navButton, { borderColor: tokens.border }]}
          onPress={() => setCursor((c) => shiftMonth(c, -1))}
        >
          <ChevronLeft size={16} color={tokens.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={mobile.hitSlop}
          style={[styles.navButton, { borderColor: tokens.border }]}
          onPress={() => setCursor((c) => shiftMonth(c, 1))}
        >
          <ChevronRight size={16} color={tokens.foreground} />
        </Pressable>
        <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{monthLabel}</Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.todayButton, { borderColor: tokens.border }]}
          onPress={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
        >
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Today</Text>
        </Pressable>
        {isLoadingMonth ? (
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>Loading…</Text>
        ) : null}
      </View>

      <View style={[styles.grid, { borderColor: tokens.border }]}>
        {WEEKDAYS.map((label) => (
          <View
            key={label}
            style={[
              styles.weekdayCell,
              { borderColor: tokens.border, backgroundColor: tokens.muted },
            ]}
          >
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>{label}</Text>
          </View>
        ))}
        {days.map((day, index) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === cursor.month;
          const preview = busy ? dayQueries[index]?.data : undefined;
          const dayRecords = preview?.records ?? recordsByDay.get(key) ?? [];
          const dayTotal = preview?.total ?? dayRecords.length;
          const totalCapped = preview?.totalCapped === true;
          return (
            <View
              key={key}
              style={[
                styles.dayCell,
                { borderColor: tokens.border, backgroundColor: inMonth ? undefined : tokens.muted },
              ]}
            >
              <View
                style={[
                  styles.dayNumberWrap,
                  key === todayKey ? { backgroundColor: tokens.primary } : null,
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    {
                      color:
                        key === todayKey
                          ? tokens.primaryForeground
                          : inMonth
                            ? tokens.foreground
                            : tokens.mutedForeground,
                    },
                  ]}
                >
                  {day.getDate()}
                </Text>
              </View>
              {dayRecords.slice(0, MAX_VISIBLE_PER_DAY).map((record) => (
                <Pressable key={record.id} onPress={() => onOpenRecord(record.id)}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.recordChip,
                      typography.caption,
                      { color: tokens.foreground, backgroundColor: `${tokens.primary}1A` },
                    ]}
                  >
                    {getRecordTitle(record)}
                  </Text>
                </Pressable>
              ))}
              {dayTotal > MAX_VISIBLE_PER_DAY ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${dayTotal}${totalCapped ? "+" : ""} records on ${key}`}
                  onPress={() => setOpenDay(key)}
                  hitSlop={mobile.hitSlop}
                >
                  <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                    {totalCapped
                      ? `${dayTotal}+`
                      : `+${dayTotal - Math.min(dayRecords.length, MAX_VISIBLE_PER_DAY)}`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {openDay ? (
        <CalendarDaySheet
          key={`${baseId}:${activeView?.id ?? ""}:${openDay}`}
          baseId={baseId}
          viewId={activeView?.id}
          fieldSlug={dateField.slug}
          day={openDay}
          range={getCalendarDayRange(dateField.type, dateOptions, openDay)}
          loadedRecords={busy ? null : (recordsByDay.get(openDay) ?? [])}
          knownTotal={
            busy ? dayQueries[days.findIndex((day) => dayKey(day) === openDay)]?.data : undefined
          }
          onClose={() => setOpenDay(null)}
          onOpenRecord={(id) => {
            setOpenDay(null);
            onOpenRecord(id);
          }}
        />
      ) : null}
    </View>
  );
}

function CalendarDaySheet({
  baseId,
  viewId,
  fieldSlug,
  day,
  range,
  loadedRecords,
  knownTotal,
  onClose,
  onOpenRecord,
}: {
  baseId: string;
  viewId?: string;
  fieldSlug: string;
  day: string;
  range: { gte: string; lt: string } | null;
  loadedRecords: RecordVO[] | null;
  knownTotal?: { total: number; totalCapped?: boolean };
  onClose: () => void;
  onOpenRecord: (id: string) => void;
}) {
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryKey = [
    buda?.scopeKey ?? "no-connection",
    "base-calendar-range",
    baseId,
    viewId ?? "",
    fieldSlug,
    range?.gte ?? "",
    range?.lt ?? "",
    "list",
  ];
  const query = useInfiniteQuery({
    queryKey,
    retry: retryCalendarRead,
    queryFn:
      buda && baseId && range && loadedRecords === null
        ? ({ pageParam }: { pageParam: number }) =>
            buda.client.records.listPage({
              baseId,
              ...(viewId ? { viewId } : {}),
              dateRange: { fieldSlug, ...range },
              page: pageParam,
              pageSize: DAY_PAGE_SIZE,
              // Grow only with pages the reader asks for, so both count and page
              // remain bounded without making the 1,000+ preview a hard list cap.
              totalLimit: Math.min(
                MAX_DAY_RECORDS,
                Math.max(PREVIEW_TOTAL_LIMIT, pageParam * DAY_PAGE_SIZE + 1),
              ),
            })
        : skipToken,
    initialPageParam: 1,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
  });
  useMobileQueryRecovery(buda && range && loadedRecords === null ? [queryKey] : []);
  const pages = query.data?.pages ?? [];
  const records = loadedRecords ?? pages.flatMap((page) => page.records);
  const counted = loadedRecords === null ? (pages.at(-1) ?? knownTotal) : undefined;
  const total = loadedRecords?.length ?? counted?.total;
  return (
    <NativeBottomSheet visible title={day} showCloseButton onClose={onClose} maxHeight="80%">
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>
        {total === undefined ? "Loading…" : `${total}${counted?.totalCapped ? "+" : ""} records`}
      </Text>
      {loadedRecords === null && query.isError ? (
        <NativeInlineError
          message={query.error instanceof Error ? query.error.message : "Couldn't load this day."}
        />
      ) : null}
      <ScrollView style={styles.dayList}>
        {records.map((record) => (
          <Pressable
            key={record.id}
            accessibilityRole="button"
            style={styles.dayRow}
            onPress={() => onOpenRecord(record.id)}
          >
            <Text numberOfLines={1} style={[typography.body, { color: tokens.foreground }]}>
              {getRecordTitle(record)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {counted?.totalCapped && records.length >= MAX_DAY_RECORDS ? (
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          Add a filter to see the remaining records.
        </Text>
      ) : null}
      {loadedRecords === null && (query.isError || query.hasNextPage) ? (
        <Pressable
          accessibilityRole="button"
          disabled={query.isFetching}
          onPress={() => void (query.isError ? query.refetch() : query.fetchNextPage())}
        >
          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
            {query.isFetching ? "Loading…" : query.isError ? "Retry day" : "Load more"}
          </Text>
        </Pressable>
      ) : null}
    </NativeBottomSheet>
  );
}

const styles = StyleSheet.create({
  error: { gap: spacing[2], marginBottom: spacing[3] },
  dayList: { maxHeight: 400 },
  dayRow: { paddingVertical: spacing[2] },
  container: { paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  emptyText: { paddingHorizontal: spacing[3], paddingVertical: spacing[6] },
  nav: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginBottom: spacing[3] },
  navButton: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  todayButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  weekdayCell: {
    width: "14.28%",
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayCell: {
    width: "14.28%",
    minHeight: 72,
    padding: 4,
    gap: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayNumberWrap: {
    alignSelf: "flex-end",
    width: 18,
    height: 18,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  recordChip: {
    borderRadius: radius.sm,
    paddingHorizontal: 3,
    paddingVertical: 1,
  },
});
