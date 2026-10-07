import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import type { RecordVO } from "busabase-contract/types";
import { getCalendarDateRange, getDateFieldOptions } from "busabase-core/base/date-value";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { resolveDateField } from "busabase-core/domains/base/utils/view-field-resolution";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeInlineError } from "~/components/native-screen";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { BaseDetailController } from "../hooks/use-base-detail-controller";
import { buildMonthGrid, dayKey, recordDayKey, shiftMonth } from "../utils/calendar-grid";

/** Records per request within the current month's slice (server max is 100). */
const RANGE_PAGE_SIZE = 100;
const MAX_VISIBLE_PER_DAY = 4;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  base: BaseDetailController["base"];
  activeView: BaseDetailController["activeView"];
  fields: BaseDetailController["previewFields"];
  onOpenRecord: (recordId: string) => void;
}

/**
 * A month grid of records positioned by a date field — mirrors web's
 * `BusaBaseCalendar`, including its month-scoped `dateRange` query (not the
 * whole Base): the grid needs an exact per-day count for the "+N" overflow
 * badge, so the visible month's slice is drained fully rather than lazily
 * paginated like List/Table/Gallery.
 */
export function BaseCalendarView({ base, activeView, fields, onOpenRecord }: Props) {
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const dateField = resolveDateField(base, fields, activeView?.config.dateFieldSlug);
  const baseId = base?.id ?? "";
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const { gridStart, gridEnd, days } = buildMonthGrid(cursor.year, cursor.month);
  // Same bounds as web: a `date` field's day values sit at UTC midnight.
  const range = getCalendarDateRange(dateField?.type, gridStart, gridEnd);

  const rangeQuery = useInfiniteQuery({
    queryKey: [
      "base-calendar-range",
      buda?.serverUrl,
      buda?.spaceScope,
      baseId,
      activeView?.id ?? "",
      dateField?.slug ?? "",
      range.gte,
      range.lt,
    ],
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
              ...(activeView?.id ? { viewId: activeView.id } : {}),
            })
        : skipToken,
    initialPageParam: 1,
    getNextPageParam: (last: { page: number; totalPages: number }) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
  });

  // A day cell's overflow badge needs the TRUE count for every day in the
  // grid, not just the first page — so this month-scoped slice is drained
  // fully. Switching months changes `queryKey`, so the grid never shows a
  // stale month's records while this runs.
  useEffect(() => {
    if (rangeQuery.hasNextPage && !rangeQuery.isFetchingNextPage) {
      void rangeQuery.fetchNextPage();
    }
  }, [rangeQuery.hasNextPage, rangeQuery.isFetchingNextPage, rangeQuery.fetchNextPage]);

  if (!dateField) {
    return (
      <Text style={[typography.body, styles.emptyText, { color: tokens.mutedForeground }]}>
        Add a date field to place records on the calendar.
      </Text>
    );
  }

  const records = (rangeQuery.data?.pages ?? []).flatMap((page) => page.records);
  const isLoadingMonth =
    rangeQuery.isPending || rangeQuery.hasNextPage || rangeQuery.isFetchingNextPage;

  const dateOptions = getDateFieldOptions(dateField.options);
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
      {rangeQuery.isError ? <NativeInlineError message="Couldn't load this month." /> : null}
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
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === cursor.month;
          const dayRecords = recordsByDay.get(key) ?? [];
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
              {dayRecords.length > MAX_VISIBLE_PER_DAY ? (
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                  +{dayRecords.length - MAX_VISIBLE_PER_DAY}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
