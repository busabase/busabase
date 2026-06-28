import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useNativeQuery } from "~/hooks/use-native-query";
import { type ActivityEvent, type ActivityTone, buildActivityEvents } from "~/lib/activity-events";
import { formatDate } from "~/lib/format";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const toneLabel: Record<ActivityTone, string> = {
  audit: "Audit",
  change_request: "Change request",
  operation: "Operation",
  commit: "Commit",
  record: "Record",
};

function ActivityContent() {
  const router = useRouter();
  const tokens = useTokens();
  const client = useBusabaseClient();

  const load = useCallback(async (): Promise<ActivityEvent[]> => {
    if (!client) {
      return [];
    }
    const [changeRequests, records, auditEvents] = await Promise.all([
      client.changeRequests.list({ limit: 100 }),
      client.records.list({ limit: 100 }),
      client.auditEvents.list({ limit: 100 }).catch(() => []),
    ]);
    return buildActivityEvents(changeRequests, records, auditEvents);
  }, [client]);

  const query = useNativeQuery(!!client, load);

  const { today, earlier } = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const events = query.data ?? [];
    return {
      today: events.filter((event) => new Date(event.timestamp) >= startOfDay),
      earlier: events.filter((event) => new Date(event.timestamp) < startOfDay),
    };
  }, [query.data]);

  const openEvent = (event: ActivityEvent) => {
    if (event.target.kind === "change-request") {
      router.push({ pathname: "/change-requests/[id]", params: { id: event.target.id } });
    } else if (event.target.kind === "record") {
      router.push({ pathname: "/records/[id]", params: { id: event.target.id } });
    }
  };

  const renderRow = (event: ActivityEvent) => (
    <Pressable
      key={event.id}
      accessibilityRole={event.target.kind === "none" ? undefined : "button"}
      disabled={event.target.kind === "none"}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: tokens.card, borderColor: tokens.border, opacity: pressed ? 0.78 : 1 },
      ]}
      onPress={() => openEvent(event)}
    >
      <View style={styles.rowTop}>
        <View style={[styles.tone, { backgroundColor: tokens.muted }]}>
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
            {toneLabel[event.tone]}
          </Text>
        </View>
        <Text style={[typography.small, { color: tokens.mutedForeground }]}>
          {formatDate(event.timestamp)}
        </Text>
      </View>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{event.title}</Text>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{event.body}</Text>
    </Pressable>
  );

  return (
    <DrawerScaffold
      title="Activity"
      subtitle="Review, merge, and audit events"
      refreshing={query.refreshing}
      onRefresh={query.refetch}
    >
      {query.loading ? <NativeLoadingState label="Loading activity" /> : null}
      {query.error ? <NativeErrorState message={query.error} onRetry={query.refetch} /> : null}
      {!query.loading && !query.error && (query.data?.length ?? 0) === 0 ? (
        <NativeEmptyState
          title="No activity yet"
          description="Change requests, merges, records, and audit events will appear here."
        />
      ) : null}
      {today.length > 0 ? (
        <View style={styles.group}>
          <Text style={[typography.caption, styles.groupLabel, { color: tokens.mutedForeground }]}>
            TODAY
          </Text>
          {today.map(renderRow)}
        </View>
      ) : null}
      {earlier.length > 0 ? (
        <View style={styles.group}>
          <Text style={[typography.caption, styles.groupLabel, { color: tokens.mutedForeground }]}>
            EARLIER
          </Text>
          {earlier.map(renderRow)}
        </View>
      ) : null}
    </DrawerScaffold>
  );
}

export default function ActivityScreen() {
  return (
    <ConnectionGuard>
      <ActivityContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  group: { marginHorizontal: 20, marginBottom: 8, gap: 10 },
  groupLabel: { marginTop: 6 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  tone: {
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
});
