import type { ChangeRequestVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ChangeRequestCard } from "~/domains/review/components/ChangeRequestCard";
import { useInboxChangeRequests } from "~/domains/review/hooks/use-inbox-change-requests";
import type { InboxMode } from "~/domains/review/utils/inbox-paging";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";

const modes = [
  { key: "review", label: "Review" },
  { key: "mine", label: "Mine" },
  { key: "done", label: "Done" },
] as const satisfies readonly { key: InboxMode; label: string }[];

const emptyCopy: Record<InboxMode, string> = {
  review: "Inbox is clear",
  mine: "Nothing created yet",
  done: "No completed reviews",
};

const isRecentChangeRequest = (changeRequest: ChangeRequestVO) => {
  const updatedAt = new Date(changeRequest.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    return false;
  }
  return Date.now() - updatedAt < 24 * 60 * 60 * 1000;
};

function InboxContent() {
  const router = useRouter();
  const [activeMode, setActiveMode] = useState<InboxMode>("review");
  // Each tab is its own server-side query: the filtering that used to happen
  // here, over a single capped page, could only ever be right for a workspace
  // small enough to fit in it.
  const inbox = useInboxChangeRequests(activeMode);

  // Refresh whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        inbox.refetch();
      }
    });
    return () => subscription.remove();
  }, [inbox.refetch]);

  const changeRequests = inbox.changeRequests;

  // Grouping is presentation over the rows already fetched, not filtering:
  // every row here already belongs to this tab.
  const groups = useMemo(() => {
    if (activeMode === "mine") {
      const isOpen = (changeRequest: ChangeRequestVO) =>
        changeRequest.status === "in_review" || changeRequest.status === "approved";
      return [
        { title: "Open", items: changeRequests.filter(isOpen) },
        { title: "Closed", items: changeRequests.filter((cr) => !isOpen(cr)) },
      ].filter((group) => group.items.length > 0);
    }
    if (activeMode === "done") {
      return [
        { title: "Merged", items: changeRequests.filter((cr) => cr.status === "merged") },
        { title: "Rejected", items: changeRequests.filter((cr) => cr.status === "rejected") },
      ].filter((group) => group.items.length > 0);
    }
    if (activeMode === "review") {
      const needsReview = changeRequests.filter((cr) => cr.status === "in_review");
      return [
        { title: "Ready to merge", items: changeRequests.filter((cr) => cr.status === "approved") },
        { title: "New", items: needsReview.filter(isRecentChangeRequest) },
        { title: "Earlier", items: needsReview.filter((cr) => !isRecentChangeRequest(cr)) },
      ].filter((group) => group.items.length > 0);
    }
    return null;
  }, [activeMode, changeRequests]);

  const showGroups = (groups ?? []).some((group) => group.items.length > 0);
  const activeLabel = modes.find((mode) => mode.key === activeMode)?.label ?? "Inbox";

  const openChangeRequest = (changeRequest: ChangeRequestVO) =>
    router.push({
      pathname: "/change-requests/[id]",
      params: { id: changeRequest.id },
    });

  const renderGroup = (group: { title: string; items: ChangeRequestVO[] }) => {
    if (group.items.length === 0) {
      return null;
    }
    return (
      <NativeSection key={group.title} title={group.title} caption={`${group.items.length}`}>
        {group.items.map((changeRequest, index) => (
          <ChangeRequestCard
            key={changeRequest.id}
            changeRequest={changeRequest}
            last={index === group.items.length - 1}
            onPress={() => openChangeRequest(changeRequest)}
          />
        ))}
      </NativeSection>
    );
  };

  return (
    <DrawerScaffold title="Inbox" refreshing={inbox.refreshing} onRefresh={inbox.refetch}>
      <View style={styles.segmentWrap}>
        <NativeSegmentedControl
          value={activeMode}
          options={modes.map((mode) => ({
            value: mode.key,
            label: mode.label,
            // Absent on a server that cannot count the whole space, which
            // renders no badge — better than a number taken from one page,
            // which reads as a total and silently understates it.
            meta: inbox.counts?.[mode.key],
          }))}
          onChange={setActiveMode}
        />
      </View>

      {inbox.loading ? <NativeLoadingState label="Loading change requests" /> : null}
      {inbox.error ? (
        <NativeErrorState message={inbox.error.message} onRetry={inbox.refetch} />
      ) : null}
      {!inbox.loading && !inbox.error && changeRequests.length === 0 ? (
        <NativeEmptyState title={emptyCopy[activeMode]} />
      ) : null}
      {showGroups
        ? (groups ?? []).map(renderGroup)
        : changeRequests.length > 0 && (
            <NativeSection title={activeLabel} caption={`${changeRequests.length}`}>
              {changeRequests.map((changeRequest, index) => (
                <ChangeRequestCard
                  key={changeRequest.id}
                  changeRequest={changeRequest}
                  last={index === changeRequests.length - 1}
                  onPress={() => openChangeRequest(changeRequest)}
                />
              ))}
            </NativeSection>
          )}
      {inbox.hasMore ? (
        <View style={styles.loadMoreWrap}>
          <NativeActionBar>
            <Button
              label={inbox.loadingMore ? "Loading…" : "Load more"}
              variant="secondary"
              disabled={inbox.loadingMore}
              onPress={inbox.loadMore}
            />
          </NativeActionBar>
        </View>
      ) : null}
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
  segmentWrap: { marginTop: 10, marginBottom: 2 },
  loadMoreWrap: { paddingHorizontal: 16, paddingVertical: 12 },
});
