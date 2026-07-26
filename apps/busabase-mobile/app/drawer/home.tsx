import { skipToken, useQuery } from "@tanstack/react-query";
import { getNodeType } from "busabase-contract/domains";
import {
  HOME_ACTIVITY_PREVIEW_COUNT,
  HOME_PENDING_PREVIEW_COUNT,
  HOME_RECENT_PREVIEW_COUNT,
  isHomeDigestEmpty,
  selectPendingChangeRequests,
} from "busabase-core/dashboard/home";
import { useRouter } from "expo-router";
import {
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  ShieldCheck,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ChangeRequestCard } from "~/components/busabase/ChangeRequestCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { CreateNodeModal } from "~/components/busabase/CreateNodeModal";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { EmptyWorkspaceGuide } from "~/components/busabase/EmptyWorkspaceGuide";
import {
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { fmt, useI18n } from "~/i18n";
import type { ActivityEvent, ActivityTone } from "~/lib/activity-events";
import { formatDate } from "~/lib/format";
import { useActivityFeed } from "~/lib/use-activity-feed";
import type { KnownNode } from "~/search/known-node-cache";
import { nodeIconForType } from "~/search/node-icons";
import { getMobileNodeDestination } from "~/search/node-navigation";
import { useKnownNodeCache } from "~/search/use-known-node-cache";
import { typography } from "~/theme/tokens";
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
      ? buda.orpc.changeRequests.list.queryOptions({ input: { limit: 100 } })
      : { queryKey: ["no-connection", "changeRequests", "list"], queryFn: skipToken },
  );
  const activityQuery = useActivityFeed();

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
      subtitle={t.home.subtitle}
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
        <>
          {/* Only rendered when something is genuinely waiting — an empty
              "Waiting for your review" card is exactly the cold greeting this
              landing screen exists to avoid. */}
          {pending.length > 0 ? (
            <NativeSection
              title={t.home.pendingTitle}
              caption={fmt(t.home.pendingCount, { count: pending.length })}
            >
              {pending.slice(0, HOME_PENDING_PREVIEW_COUNT).map((changeRequest) => (
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
              <NativeRow
                title={t.home.pendingViewAll}
                onPress={() => router.replace("/drawer/inbox")}
                last
              />
            </NativeSection>
          ) : null}

          <NativeSection title={t.home.recentTitle}>
            {recent.length > 0 ? (
              recent.map((node, index) => {
                const Icon = nodeIconForType(node.type);
                return (
                  <NativeRow
                    key={node.id}
                    title={node.name}
                    subtitle={getNodeType(node.type)?.label ?? node.type}
                    leading={<Icon size={18} color={tokens.mutedForeground} />}
                    onPress={() => openNode(node)}
                    last={index === recent.length - 1}
                  />
                );
              })
            ) : (
              <HomeHint>{t.home.recentEmptyBody}</HomeHint>
            )}
          </NativeSection>

          <NativeSection title={t.home.activityTitle}>
            {activityQuery.isPending ? (
              <NativeLoadingState label={t.common.loading} />
            ) : activityEvents.length > 0 ? (
              <>
                {activityEvents.map((event, index) => {
                  const Icon = toneIcons[event.tone] ?? CircleDot;
                  return (
                    <NativeRow
                      key={event.id}
                      title={event.title}
                      subtitle={event.body}
                      meta={formatDate(event.timestamp)}
                      leading={<Icon size={18} color={tokens.mutedForeground} />}
                      onPress={event.target.kind === "none" ? undefined : () => openEvent(event)}
                      last={index === activityEvents.length - 1}
                    />
                  );
                })}
                <NativeRow
                  title={t.home.activityViewAll}
                  onPress={() => router.replace("/drawer/activity")}
                  last
                />
              </>
            ) : (
              <HomeHint>{t.home.activityEmptyBody}</HomeHint>
            )}
          </NativeSection>
        </>
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
  hint: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    borderStyle: "dashed",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});
