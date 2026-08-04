import { skipToken, useQuery } from "@tanstack/react-query";
import {
  HOME_ACTIVITY_PREVIEW_COUNT,
  HOME_PENDING_PREVIEW_COUNT,
  HOME_RECENT_PREVIEW_COUNT,
  isHomeDigestEmpty,
  selectPendingChangeRequests,
} from "busabase-core/dashboard/home";
import { useRouter } from "expo-router";
import {
  ChevronRight,
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  ShieldCheck,
} from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ChangeRequestCard } from "~/components/busabase/ChangeRequestCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { CreateNodeModal } from "~/components/busabase/CreateNodeModal";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { EmptyWorkspaceGuide } from "~/components/busabase/EmptyWorkspaceGuide";
import { NativeErrorState, NativeLoadingState, NativeRow } from "~/components/native-screen";
import { fmt, useI18n } from "~/i18n";
import type { ActivityEvent, ActivityTone } from "~/lib/activity-events";
import { formatListTime } from "~/lib/format";
import { useActivityFeed } from "~/lib/use-activity-feed";
import type { KnownNode } from "~/search/known-node-cache";
import { nodeIconForType } from "~/search/node-icons";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { mobile, radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const toneIcons: Record<ActivityTone, typeof GitPullRequest> = {
  audit: ShieldCheck,
  change_request: GitPullRequest,
  operation: ListChecks,
  commit: GitCommitHorizontal,
  record: FileText,
};

/** Dashed hint line used where a section has nothing yet — never a blank gap. */
function HomeHint({ children }: { children: string }) {
  const tokens = useTokens();

  return (
    <View style={[styles.hint, { borderColor: tokens.border }]}>
      <Text style={[typography.small, { color: tokens.mutedForeground }]}>{children}</Text>
    </View>
  );
}

function HomeSection({
  actionAccessibilityLabel,
  actionLabel,
  children,
  onAction,
  title,
}: {
  actionAccessibilityLabel?: string;
  actionLabel?: string;
  children: ReactNode;
  onAction?: () => void;
  title: string;
}) {
  const tokens = useTokens();

  return (
    <View style={styles.homeSection}>
      <View style={styles.sectionHeader}>
        <Text
          numberOfLines={1}
          style={[typography.small, styles.sectionTitle, { color: tokens.mutedForeground }]}
        >
          {title}
        </Text>
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
            hitSlop={mobile.hitSlop}
            style={({ pressed }) => [styles.sectionAction, { opacity: pressed ? 0.6 : 1 }]}
            onPress={onAction}
          >
            <Text
              style={[typography.small, styles.sectionActionLabel, { color: tokens.foreground }]}
            >
              {actionLabel}
            </Text>
            <ChevronRight size={14} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The landing digest. Answers "where do I pick up?" with three stacked signals —
 * what needs you, what you were last in, what the workspace has been doing —
 * instead of dropping every visitor straight into Inbox, whose empty state
 * reads as "nothing here for you" to anyone without a pending review.
 *
 * Mirrors the web dashboard's HomeView
 * (packages/busabase-core/src/domains/dashboard/components/home.tsx); the
 * section rules (what counts as pending, how many rows each preview shows) come
 * from the shared `busabase-core/dashboard/home` helpers so the two can't drift.
 */
function HomeContent() {
  const router = useRouter();
  const tokens = useTokens();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const nodeCache = useKnownNodeCache();

  const changeRequestsQuery = useQuery(
    buda
      ? buda.orpc.changeRequests.list.queryOptions({
          input: { limit: 100 },
          select: (page) => page.changeRequests,
        })
      : { queryKey: ["no-connection", "changeRequests", "list"], queryFn: skipToken },
  );
  const activityQuery = useActivityFeed(HOME_ACTIVITY_PREVIEW_COUNT);

  const pending = useMemo(
    () => selectPendingChangeRequests(changeRequestsQuery.data ?? []),
    [changeRequestsQuery.data],
  );

  // The same store the search screen reads — visiting a node anywhere in the app
  // already records it, so this feed needs no tracking of its own.
  const [recent, setRecent] = useState<KnownNode[]>([]);
  // Own instance rather than the drawer's — the guide's CTA has to work without
  // making the user open the drawer first, which is the whole point of it.
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (!nodeCache) {
      setRecent([]);
      return;
    }
    let cancelled = false;
    const read = () => {
      void nodeCache.listVisited().then((nodes) => {
        if (!cancelled) setRecent(nodes.slice(0, HOME_RECENT_PREVIEW_COUNT));
      });
    };
    read();
    const unsubscribe = nodeCache.subscribe(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [nodeCache]);

  const activityEvents = (activityQuery.data ?? []).slice(0, HOME_ACTIVITY_PREVIEW_COUNT);
  const recentRows = useMemo(() => {
    const rows: KnownNode[][] = [];
    for (let index = 0; index < recent.length; index += 2) {
      rows.push(recent.slice(index, index + 2));
    }
    return rows;
  }, [recent]);

  // A brand-new workspace gets the onboarding guide rather than three empty shells.
  const isEverythingEmpty = isHomeDigestEmpty({
    activityCount: activityEvents.length,
    isActivityLoaded: !activityQuery.isPending,
    pendingCount: pending.length,
    recentCount: recent.length,
  });

  const openNode = (node: KnownNode) => {
    const destination = getMobileNodeDestination(node);
    if (destination.status === "unsupported") return;
    void nodeCache?.markVisited(node.id);
    router.push({ pathname: destination.pathname, params: destination.params } as never);
  };

  const openEvent = (event: ActivityEvent) => {
    if (event.target.kind === "change-request") {
      router.push({ pathname: "/change-requests/[id]", params: { id: event.target.id } });
    } else if (event.target.kind === "operation") {
      router.push({
        pathname: "/change-requests/[id]/operations/[operationId]",
        params: { id: event.target.changeRequestId, operationId: event.target.operationId },
      });
    } else if (event.target.kind === "record") {
      router.push({ pathname: "/records/[id]", params: { id: event.target.id } });
    }
  };

  const refetchAll = () => {
    void changeRequestsQuery.refetch();
    void activityQuery.refetch();
  };

  return (
    <DrawerScaffold
      title={t.home.title}
      contentWidth="readable"
      refreshing={changeRequestsQuery.isRefetching || activityQuery.isRefetching}
      onRefresh={refetchAll}
    >
      {changeRequestsQuery.error ? (
        <NativeErrorState
          message={changeRequestsQuery.error.message}
          onRetry={() => void changeRequestsQuery.refetch()}
        />
      ) : null}

      {isEverythingEmpty ? (
        <EmptyWorkspaceGuide onCreate={() => setCreateOpen(true)} />
      ) : (
        <View style={styles.homeDigest}>
          {/* Only rendered when something is genuinely waiting — an empty
              "Waiting for your review" card is exactly the cold greeting this
              landing screen exists to avoid. */}
          {pending.length > 0 ? (
            <HomeSection
              title={t.home.pendingTitle}
              actionLabel={fmt(t.home.pendingCount, { count: pending.length })}
              actionAccessibilityLabel={t.home.pendingViewAll}
              onAction={() => router.push("/drawer/inbox")}
            >
              <View
                style={[
                  styles.listGroup,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                {pending.slice(0, HOME_PENDING_PREVIEW_COUNT).map((changeRequest, index, items) => (
                  <ChangeRequestCard
                    key={changeRequest.id}
                    changeRequest={changeRequest}
                    last={index === items.length - 1}
                    onPress={() =>
                      router.push({
                        pathname: "/change-requests/[id]",
                        params: { id: changeRequest.id },
                      })
                    }
                  />
                ))}
              </View>
            </HomeSection>
          ) : null}

          <HomeSection title={t.home.recentTitle}>
            {recent.length > 0 ? (
              <View style={styles.recentGrid}>
                {recentRows.map((row) => (
                  <View key={row[0]?.id} style={styles.recentRow}>
                    {row.map((node) => {
                      const Icon = nodeIconForType(node.type);
                      return (
                        <Pressable
                          key={node.id}
                          accessibilityRole="button"
                          accessibilityLabel={node.name}
                          style={({ pressed }) => [
                            styles.recentCard,
                            { backgroundColor: tokens.card, borderColor: tokens.border },
                            { opacity: pressed ? 0.68 : 1 },
                          ]}
                          onPress={() => openNode(node)}
                        >
                          <Icon size={17} color={tokens.mutedForeground} />
                          <Text
                            numberOfLines={1}
                            style={[
                              typography.small,
                              styles.recentTitle,
                              { color: tokens.foreground },
                            ]}
                          >
                            {node.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {row.length === 1 ? <View style={styles.recentSpacer} /> : null}
                  </View>
                ))}
              </View>
            ) : (
              <HomeHint>{t.home.recentEmptyBody}</HomeHint>
            )}
          </HomeSection>

          <HomeSection
            title={t.home.activityTitle}
            actionLabel={t.home.activityViewAll}
            onAction={() => router.push("/drawer/activity")}
          >
            {activityQuery.isPending ? (
              <NativeLoadingState label={t.common.loading} />
            ) : activityEvents.length > 0 ? (
              <View
                style={[
                  styles.listGroup,
                  { backgroundColor: tokens.card, borderColor: tokens.border },
                ]}
              >
                {activityEvents.map((event, index) => {
                  const Icon = toneIcons[event.tone] ?? CircleDot;
                  return (
                    <NativeRow
                      key={event.id}
                      title={event.title}
                      meta={formatListTime(event.timestamp)}
                      leading={<Icon size={18} color={tokens.mutedForeground} />}
                      onPress={event.target.kind === "none" ? undefined : () => openEvent(event)}
                      last={index === activityEvents.length - 1}
                    />
                  );
                })}
              </View>
            ) : (
              <HomeHint>{t.home.activityEmptyBody}</HomeHint>
            )}
          </HomeSection>
        </View>
      )}
      <CreateNodeModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(changeRequestId) => {
          setCreateOpen(false);
          // Node creation is a change request; open it for review (the node
          // appears after merge). Same hand-off the drawer's create flow uses.
          router.push({ pathname: "/change-requests/[id]", params: { id: changeRequestId } });
        }}
      />
    </DrawerScaffold>
  );
}

export default function HomeScreen() {
  return (
    <ConnectionGuard>
      <HomeContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  homeDigest: {
    marginHorizontal: spacing[5],
    paddingTop: spacing[4],
    gap: spacing[6],
  },
  homeSection: { gap: spacing[2] },
  sectionHeader: {
    minHeight: 24,
    paddingHorizontal: spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  sectionTitle: { flex: 1, minWidth: 0, fontWeight: "500" },
  sectionAction: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingLeft: spacing[2],
  },
  sectionActionLabel: { fontWeight: "500" },
  listGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  recentGrid: { gap: spacing[2] },
  recentRow: { flexDirection: "row", gap: spacing[2] },
  recentCard: {
    minWidth: 0,
    minHeight: 48,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  recentSpacer: { flex: 1 },
  recentTitle: { flex: 1, minWidth: 0, fontWeight: "500" },
  hint: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    borderStyle: "dashed",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
});
