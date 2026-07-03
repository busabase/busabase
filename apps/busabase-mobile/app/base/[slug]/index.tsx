import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { iStringParse } from "openlib/i18n/i-string";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { FieldValue } from "~/components/busabase/FieldValue";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { getRecordTitle } from "~/lib/busabase-display";
import { applyViewConfig } from "~/lib/view-config";
import { radius, typography } from "~/theme/tokens";
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
    >
      {loading ? <NativeLoadingState label="Loading base" /> : null}
      {error ? <NativeErrorState message={error.message} onRetry={refresh} /> : null}
      {!loading && !error && !base ? (
        <NativeEmptyState title="Base not found" description="This base is not available." />
      ) : null}
      {base ? (
        <View style={styles.content}>
          {base.description ? (
            <Text style={[typography.body, styles.description, { color: tokens.mutedForeground }]}>
              {base.description}
            </Text>
          ) : null}

          <View style={styles.baseActions}>
            <View style={styles.baseActionItem}>
              <Button
                label="New record"
                fullWidth
                onPress={() =>
                  router.push({ pathname: "/base/[slug]/new", params: { slug: base.slug } })
                }
              />
            </View>
            <View style={styles.baseActionItem}>
              <Button
                label="Design"
                variant="secondary"
                fullWidth
                onPress={() =>
                  router.push({ pathname: "/base/[slug]/design", params: { slug: base.slug } })
                }
              />
            </View>
          </View>

          {views.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.viewsScroll}
              contentContainerStyle={styles.views}
            >
              {[{ id: null as string | null, name: "All" }, ...views].map((view) => {
                const active = view.id === activeViewId;
                return (
                  <Pressable
                    key={view.id ?? "all"}
                    accessibilityRole="button"
                    style={[
                      styles.viewChip,
                      {
                        backgroundColor: active ? tokens.primaryMuted : tokens.card,
                        borderColor: active ? tokens.primary : tokens.border,
                      },
                    ]}
                    onPress={() => setActiveViewId(view.id)}
                  >
                    <Text
                      style={[
                        typography.small,
                        { color: active ? tokens.foreground : tokens.mutedForeground },
                      ]}
                    >
                      {view.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {records.length === 0 ? (
            <NativeEmptyState
              title="No records"
              description="Merged records for this base will show here."
            />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
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
                {records.map((record) => (
                  <Pressable
                    key={record.id}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.tableRow,
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
          )}
        </View>
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
  content: { gap: 12 },
  description: { marginHorizontal: 20 },
  baseActions: { flexDirection: "row", gap: 10, marginHorizontal: 20 },
  baseActionItem: { flex: 1 },
  viewsScroll: { flexGrow: 0 },
  views: { paddingHorizontal: 20, gap: 8 },
  viewChip: {
    minHeight: 34,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
  },
  tableScroll: { paddingLeft: 20 },
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
  firstCell: { width: FIRST_COLUMN_WIDTH },
  cell: { width: COLUMN_WIDTH, overflow: "hidden" },
});
