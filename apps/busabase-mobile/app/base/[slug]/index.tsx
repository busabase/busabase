import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { List, MoreHorizontal, Plus, Settings2, Table2 } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { FieldList } from "~/components/busabase/FieldList";
import { FieldValue } from "~/components/busabase/FieldValue";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeChipList,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { getPreview, getRecordTitle } from "~/lib/busabase-display";
import { formatListTime } from "~/lib/format";
import { applyViewConfig } from "~/lib/view-config";
import { mobile, radius, typography } from "~/theme/tokens";
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
  const [displayMode, setDisplayMode] = useState<"list" | "table">("list");
  const [actionsOpen, setActionsOpen] = useState(false);

  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({})
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const recordsQuery = useQuery(
    buda
      ? buda.orpc.records.list.queryOptions({ input: { limit: 100 } })
      : { queryKey: ["no-connection", "records", "list"], queryFn: skipToken },
  );

  const base = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );

  const viewsQuery = useQuery(
    buda && base
      ? buda.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );
  const views = viewsQuery.data ?? [];
  const activeView = views.find((view) => view.id === activeViewId) ?? null;

  const records = useMemo(() => {
    const baseRecords = recordsQuery.data?.filter((record) => record.baseId === base?.id) ?? [];
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

  const refresh = () => {
    void basesQuery.refetch();
    void recordsQuery.refetch();
    void viewsQuery.refetch();
  };

  const loading = basesQuery.isLoading || recordsQuery.isLoading;
  const error = basesQuery.error ?? recordsQuery.error;

  return (
    <DrawerScaffold
      title={base?.name ?? "Base"}
      subtitle={base ? `${records.length} records · ${base.fields.length} fields` : slug}
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
          <NativeSection title="Info">
            <NativeRow
              title={base.description ? "Description" : "Base"}
              subtitle={base.description || base.slug}
            />
            <NativeRow title="Fields" subtitle={`${base.fields.length} configured fields`} last />
          </NativeSection>

          {views.length > 0 ? (
            <NativeChipList
              value={activeViewId}
              options={[{ value: null as string | null, label: "All" }].concat(
                views.map((view) => ({ value: view.id, label: view.name })),
              )}
              onChange={setActiveViewId}
            />
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
            <NativeEmptyState
              title="No records"
              description="Merged records for this base will show here."
            />
          ) : displayMode === "list" ? (
            <NativeSection title="Records" caption={`${records.length}`}>
              {records.map((record, index) => {
                const title = getRecordTitle(record);
                const preview = getPreview(record.headCommit.fields);
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
                  >
                    <FieldList
                      fields={record.headCommit.fields}
                      definitions={visibleFields.slice(0, 3)}
                      limitToDefinitions
                      variant="compact"
                    />
                  </NativeRow>
                );
              })}
            </NativeSection>
          ) : (
            <NativeSection title="Table" caption={`${visibleFields.length} fields`}>
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
                    {visibleFields.map((field) => (
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
                      {visibleFields.map((field) => (
                        <View key={field.id} style={styles.cell}>
                          <FieldValue field={field} value={record.headCommit.fields[field.slug]} />
                        </View>
                      ))}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </NativeSection>
          )}

          <NativeBottomSheet
            visible={actionsOpen}
            title="Base actions"
            description="Manage this base without crowding the record list."
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
                <Button
                  label="Close"
                  variant="ghost"
                  fullWidth
                  onPress={() => setActionsOpen(false)}
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
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
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
