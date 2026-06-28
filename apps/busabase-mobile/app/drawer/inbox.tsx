import type { ChangeRequestVO } from "busabase-core/types";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ChangeRequestCard } from "~/components/busabase/ChangeRequestCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useNativeQuery } from "~/hooks/use-native-query";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

// The local self-hosted editor authors change requests under this id (matches web).
const LOCAL_AUTHOR = "local-editor";

// Mirrors the web inbox views: For review · Created · Approved · Merged · Rejected.
const tabs = [
  { key: "review", label: "For review" },
  { key: "created", label: "Created" },
  { key: "approved", label: "Approved" },
  { key: "merged", label: "Merged" },
  { key: "rejected", label: "Rejected" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const matchesTab = (changeRequest: ChangeRequestVO, tab: TabKey): boolean => {
  switch (tab) {
    case "review":
      return changeRequest.status === "in_review";
    case "created":
      return changeRequest.submittedBy === LOCAL_AUTHOR;
    case "approved":
      return changeRequest.status === "approved";
    case "merged":
      return changeRequest.status === "merged";
    case "rejected":
      return changeRequest.status === "rejected";
  }
};

const emptyCopy: Record<TabKey, { title: string; description: string }> = {
  review: {
    title: "Inbox is clear",
    description: "New change requests submitted to the connected Busabase server will appear here.",
  },
  created: {
    title: "Nothing created yet",
    description: "Change requests you submit from this device show up here.",
  },
  approved: {
    title: "Nothing approved yet",
    description: "Approved change requests wait here until they are merged.",
  },
  merged: {
    title: "Nothing merged yet",
    description: "Merged change requests become canonical records.",
  },
  rejected: {
    title: "Nothing rejected",
    description: "Change requests sent back for revision will appear here.",
  },
};

function InboxContent() {
  const router = useRouter();
  const tokens = useTokens();
  const client = useBusabaseClient();
  const [activeTab, setActiveTab] = useState<TabKey>("review");
  const loadChangeRequests = useCallback(
    () => client?.changeRequests.list({ limit: 100 }) ?? Promise.resolve([]),
    [client],
  );
  const query = useNativeQuery(!!client, loadChangeRequests);

  // Refresh whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        query.refetch();
      }
    });
    return () => subscription.remove();
  }, [query.refetch]);

  const counts = useMemo(() => {
    const next: Record<TabKey, number> = {
      review: 0,
      created: 0,
      approved: 0,
      merged: 0,
      rejected: 0,
    };
    for (const changeRequest of query.data ?? []) {
      for (const tab of tabs) {
        if (matchesTab(changeRequest, tab.key)) {
          next[tab.key] += 1;
        }
      }
    }
    return next;
  }, [query.data]);

  const visible = useMemo(
    () => (query.data ?? []).filter((changeRequest) => matchesTab(changeRequest, activeTab)),
    [query.data, activeTab],
  );

  // The "Created" view groups the editor's own requests by open vs. closed (matches web).
  const createdGroups = useMemo(() => {
    if (activeTab !== "created") {
      return null;
    }
    const isOpen = (changeRequest: ChangeRequestVO) =>
      changeRequest.status === "in_review" || changeRequest.status === "approved";
    return [
      { title: "Open change requests", items: visible.filter(isOpen) },
      { title: "Closed change requests", items: visible.filter((cr) => !isOpen(cr)) },
    ].filter((group) => group.items.length > 0);
  }, [activeTab, visible]);

  return (
    <DrawerScaffold
      title="Inbox"
      subtitle="Change requests from connected agents"
      refreshing={query.refreshing}
      onRefresh={query.refetch}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabs}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              style={[
                styles.tab,
                {
                  backgroundColor: active ? tokens.primaryMuted : tokens.card,
                  borderColor: active ? tokens.primary : tokens.border,
                },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  typography.bodyEm,
                  { color: active ? tokens.foreground : tokens.mutedForeground },
                ]}
              >
                {tab.label}
              </Text>
              <View
                style={[
                  styles.tabBadge,
                  { backgroundColor: active ? tokens.primary : tokens.muted },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? tokens.primaryForeground : tokens.mutedForeground },
                  ]}
                >
                  {counts[tab.key]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {query.loading ? <NativeLoadingState label="Loading change requests" /> : null}
      {query.error ? <NativeErrorState message={query.error} onRetry={query.refetch} /> : null}
      {!query.loading && !query.error && visible.length === 0 ? (
        <NativeEmptyState
          title={emptyCopy[activeTab].title}
          description={emptyCopy[activeTab].description}
        />
      ) : null}
      <View style={styles.list}>
        {createdGroups
          ? createdGroups.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text
                  style={[
                    typography.caption,
                    styles.groupHeader,
                    { color: tokens.mutedForeground },
                  ]}
                >
                  {group.title} · {group.items.length}
                </Text>
                {group.items.map((changeRequest) => (
                  <ChangeRequestCard
                    key={changeRequest.id}
                    changeRequest={changeRequest}
                    onPress={() =>
                      router.push({
                        pathname: "/change-requests/[id]",
                        params: { id: changeRequest.id },
                      })
                    }
                  />
                ))}
              </View>
            ))
          : visible.map((changeRequest) => (
              <ChangeRequestCard
                key={changeRequest.id}
                changeRequest={changeRequest}
                onPress={() =>
                  router.push({
                    pathname: "/change-requests/[id]",
                    params: { id: changeRequest.id },
                  })
                }
              />
            ))}
      </View>
    </DrawerScaffold>
  );
}

export default function InboxScreen() {
  return (
    <ConnectionGuard>
      <InboxContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  tabsScroll: { flexGrow: 0, marginBottom: 14 },
  tabs: { paddingHorizontal: 20, gap: 8 },
  tab: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 14,
  },
  tabBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  list: { marginHorizontal: 20, gap: 12 },
  group: { gap: 12 },
  groupHeader: { textTransform: "uppercase" },
});
