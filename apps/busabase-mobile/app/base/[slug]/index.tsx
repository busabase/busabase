import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check,
  ChevronDown,
  List,
  MoreHorizontal,
  Plus,
  Settings2,
  Table2,
} from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { FieldValue } from "~/domains/base/components/FieldValue";
import {
  normalizeRecordsPage,
  RECORDS_PAGE_SIZE,
  scopeRecordsPageToBase,
} from "~/domains/base/utils/record-pagination";
import { applyViewConfig } from "~/domains/base/utils/view-config";
import { getPreview } from "~/domains/review/utils/busabase-display";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { formatListTime } from "~/lib/format";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const FIRST_COLUMN_WIDTH = 180;
const COLUMN_WIDTH = 140;

function BaseDetailContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewPickerOpen, setViewPickerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<"list" | "table">("list");
  const [actionsOpen, setActionsOpen] = useState(false);

  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const base = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const recordsQuery = useInfiniteQuery({
    queryKey: ["base-records", buda?.serverUrl, buda?.spaceScope, base?.id, RECORDS_PAGE_SIZE],
    queryFn:
      buda && base
        ? async ({ pageParam }) =>
            normalizeRecordsPage(
              scopeRecordsPageToBase(
                await buda.client.records.list({
                  baseId: base.id,
                  cursor: pageParam,
                  limit: RECORDS_PAGE_SIZE,
                }),
                base.id,
              ),
              pageParam,
            )
        : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const viewsQuery = useQuery(
    buda && base
      ? buda.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );
  const views = viewsQuery.data ?? [];
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const selectedViewId = activeView?.id ?? null;
  const selectedViewLabel = activeView?.name ?? "All";

  const records = useMemo(() => {
    const baseRecords =
      recordsQuery.data?.pages
        .flatMap((page) => page.records)
        .filter((record) => record.baseId === base?.id) ?? [];
    return applyViewConfig(baseRecords, activeView?.config);
  }, [recordsQuery.data, base?.id, activeView]);

  const visibleFields = useMemo(() => {
    const allFields = base?.fields ?? [];
    const visibleSlugs = activeView?.config.visibleFieldSlugs;
    if (Array.isArray(visibleSlugs) && visibleSlugs.length > 0) {
      return visibleSlugs
        .map((fieldSlug) => allFields.find((field) => field.slug === fieldSlug))
        .filter((field): field is NonNullable<typeof field> => Boolean(field));
    }
    return allFields;
  }, [base?.fields, activeView]);
  const previewFields = useMemo(() => {
    const primaryFieldId = base?.fields[0]?.id;
    return visibleFields.filter((field) => field.id !== primaryFieldId);
  }, [base?.fields, visibleFields]);

  const refresh = () => {
    void basesQuery.refetch();
    void recordsQuery.refetch();
    void viewsQuery.refetch();
  };

  const loading = basesQuery.isLoading || (Boolean(base) && recordsQuery.isPending);
  const error = basesQuery.error ?? recordsQuery.error;

  return (
    <DrawerScaffold
      title={base?.name ?? "Base"}
      refreshing={basesQuery.isRefetching || recordsQuery.isRefetching}
      onRefresh={refresh}
      headerAction={
        base ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open base actions"
            hitSlop={mobile.hitSlop}
            style={[styles.moreButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={() => setActionsOpen(true)}
          >
            <MoreHorizontal size={21} color={tokens.foreground} />
          </Pressable>
        ) : undefined
      }
      footer={
        base ? (
          <NativeActionBar>
            <Button
              label="New record"
              fullWidth
              leadingIcon={<Plus size={18} color={tokens.primaryForeground} />}
              onPress={() =>
                router.push({ pathname: "/base/[slug]/new", params: { slug: base.slug } })
              }
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {loading ? <NativeLoadingState label="Loading base" /> : null}
      {error ? <NativeErrorState message={error.message} onRetry={refresh} /> : null}
      {!loading && !error && !base ? (
        <NativeEmptyState title="Base not found" description="This base is not available." />
      ) : null}
      {base ? (
        <>
          {views.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View: ${selectedViewLabel}`}
              accessibilityState={{ expanded: viewPickerOpen }}
              style={({ pressed }) => [
                styles.viewTrigger,
                {
                  backgroundColor: tokens.surface,
                  borderColor: viewPickerOpen ? tokens.primary : tokens.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
              onPress={() => setViewPickerOpen(true)}
            >
              <View style={styles.viewTriggerText}>
                <Text style={[typography.caption, { color: tokens.mutedForeground }]}>VIEW</Text>
                <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
                  {selectedViewLabel}
                </Text>
              </View>
              <ChevronDown size={18} color={tokens.mutedForeground} />
            </Pressable>
          ) : null}

          <NativeSegmentedControl
            value={displayMode}
            options={[
              {
                value: "list",
                label: "List",
                Icon: List,
              },
              {
                value: "table",
                label: "Table",
                Icon: Table2,
              },
            ]}
            onChange={setDisplayMode}
          />

          {records.length === 0 ? (
            <NativeEmptyState title="No records" />
          ) : displayMode === "list" ? (
            <NativeSection title="Records" caption={`${records.length}`}>
              {records.map((record, index) => {
                const title = getRecordTitle(record);
                const preview = getPreview(record.headCommit.payload);
                // Sparse (often single-field) records can make the preview
                // echo the title verbatim — drop it rather than show the
                // same text twice (see RecordCard.tsx for the same fix).
                const subtitle =
                  preview.trim().toLowerCase() === title.trim().toLowerCase() ? undefined : preview;
                return (
                  <NativeRow
                    key={record.id}
                    title={title}
                    subtitle={subtitle}
                    meta={formatListTime(record.updatedAt)}
                    last={index === records.length - 1}
                    onPress={() =>
                      router.push({ pathname: "/records/[id]", params: { id: record.id } })
                    }
                  />
                );
              })}
            </NativeSection>
          ) : (
            <NativeSection title="Table" caption={`${previewFields.length} fields`}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.tableScroll}
                contentContainerStyle={styles.tableContent}
              >
                <View>
                  <View style={[styles.tableHeader, { borderColor: tokens.border }]}>
                    <Text
                      style={[
                        typography.caption,
                        styles.firstCell,
                        { color: tokens.mutedForeground },
                      ]}
                    >
                      TITLE
                    </Text>
                    {previewFields.map((field) => (
                      <Text
                        key={field.id}
                        numberOfLines={1}
                        style={[typography.caption, styles.cell, { color: tokens.mutedForeground }]}
                      >
                        {iStringParse(field.name).toUpperCase()}
                      </Text>
                    ))}
                  </View>
                  {records.map((record, index) => (
                    <Pressable
                      key={record.id}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.tableRow,
                        index === records.length - 1 ? styles.tableRowLast : null,
                        { borderColor: tokens.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() =>
                        router.push({ pathname: "/records/[id]", params: { id: record.id } })
                      }
                    >
                      <Text
                        numberOfLines={1}
                        style={[typography.bodyEm, styles.firstCell, { color: tokens.foreground }]}
                      >
                        {getRecordTitle(record)}
                      </Text>
                      {previewFields.map((field) => (
                        <View key={field.id} style={styles.cell}>
                          <FieldValue
                            field={field}
                            value={record.headCommit.payload[field.slug]}
                            interactive={false}
                          />
                        </View>
                      ))}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </NativeSection>
          )}

          {recordsQuery.hasNextPage ? (
            <NativeActionBar>
              <Button
                label="Load more records"
                variant="secondary"
                loading={recordsQuery.isFetchingNextPage}
                fullWidth
                onPress={() => void recordsQuery.fetchNextPage()}
              />
            </NativeActionBar>
          ) : null}

          <NativeBottomSheet
            visible={viewPickerOpen}
            title="View"
            showCloseButton
            maxHeight="80%"
            onClose={() => setViewPickerOpen(false)}
          >
            <ScrollView
              nestedScrollEnabled
              style={[styles.viewOptions, { borderColor: tokens.border }]}
            >
              {[{ id: null as string | null, name: "All" }, ...views].map(
                (view, index, options) => {
                  const selected = view.id === selectedViewId;
                  return (
                    <Pressable
                      key={view.id ?? "all"}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.viewOption,
                        index < options.length - 1
                          ? { borderBottomWidth: StyleSheet.hairlineWidth }
                          : null,
                        {
                          backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                          borderColor: tokens.border,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                      onPress={() => {
                        setActiveViewId(view.id);
                        setViewPickerOpen(false);
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          typography.body,
                          styles.viewOptionLabel,
                          { color: tokens.foreground },
                        ]}
                      >
                        {view.name}
                      </Text>
                      {selected ? <Check size={17} color={tokens.foreground} /> : null}
                    </Pressable>
                  );
                },
              )}
            </ScrollView>
          </NativeBottomSheet>

          <NativeBottomSheet
            visible={actionsOpen}
            title="Base actions"
            showCloseButton
            onClose={() => setActionsOpen(false)}
            footer={
              <NativeActionBar>
                <Button
                  label="Edit base design"
                  variant="secondary"
                  fullWidth
                  leadingIcon={<Settings2 size={18} color={tokens.foreground} />}
                  onPress={() => {
                    setActionsOpen(false);
                    router.push({ pathname: "/base/[slug]/design", params: { slug: base.slug } });
                  }}
                />
              </NativeActionBar>
            }
          />
        </>
      ) : null}
    </DrawerScaffold>
  );
}

export default function BaseDetailScreen() {
  return (
    <ConnectionGuard>
      <BaseDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  viewTrigger: {
    minHeight: mobile.minTouchTarget,
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  viewTriggerText: { flex: 1, minWidth: 0 },
  viewOptions: {
    maxHeight: 320,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  viewOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  viewOptionLabel: { flex: 1, minWidth: 0 },
  tableScroll: { flexGrow: 0 },
  tableContent: { paddingLeft: 14 },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    paddingRight: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRowLast: { borderBottomWidth: 0 },
  firstCell: { width: FIRST_COLUMN_WIDTH },
  cell: { width: COLUMN_WIDTH, overflow: "hidden" },
});
