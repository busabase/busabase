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
import { MentionCard } from "~/domains/review/components/MentionCard";
import { useInboxChangeRequests } from "~/domains/review/hooks/use-inbox-change-requests";
import { useMentions, useMentionUnreadCount } from "~/domains/review/hooks/use-mentions";
import type { InboxMode } from "~/domains/review/utils/inbox-paging";
import { mentionDestination } from "~/domains/review/utils/mention-destination";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";

/**
 * Mentions is a fourth tab rather than a screen of its own: it answers the same
 * question the others do — "what needs me?" — and the phone should not make
 * someone remember a second place to look for it.
 */
type InboxTab = InboxMode | "mentions";

const modes = [
  { key: "review", label: "Review" },
  { key: "mine", label: "Mine" },
  { key: "done", label: "Done" },
  { key: "mentions", label: "Mentions" },
] as const satisfies readonly { key: InboxTab; label: string }[];

const emptyCopy: Record<InboxTab, string> = {
  review: "Inbox is clear",
  mine: "Nothing created yet",
  done: "No completed reviews",
  mentions: "No one has mentioned you",
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
  const [activeMode, setActiveMode] = useState<InboxTab>("review");
  const showingMentions = activeMode === "mentions";
  // Each tab is its own server-side query: the filtering that used to happen
  // here, over a single capped page, could only ever be right for a workspace
  // small enough to fit in it.
  const inbox = useInboxChangeRequests(showingMentions ? "review" : activeMode, {
    enabled: !showingMentions,
  });
  const mentions = useMentions({ enabled: showingMentions });
  // Fetched on every tab, unlike the change-request counts: see the hook — this
  // badge is a notification, not a summary of the tab you are looking at.
  const mentionUnread = useMentionUnreadCount();

  // Refresh whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (showingMentions) mentions.refetch();
        else inbox.refetch();
      }
    });
    return () => subscription.remove();
  }, [inbox.refetch, mentions.refetch, showingMentions]);

  const changeRequests = inbox.changeRequests;
  const active = showingMentions ? mentions : inbox;
  const openMention = (item: (typeof mentions.items)[number]) => {
    // Stamped on open regardless of where it goes — the person has seen it.
    mentions.markRead(item.commentId);
    const destination = mentionDestination(item.href);
    if (destination.kind === "change-request") {
      router.push({
        pathname: "/change-requests/[id]",
        params: { id: destination.changeRequestId },
      });
    } else if (destination.kind === "operation") {
      router.push({
        pathname: "/change-requests/[id]/operations/[operationId]",
        params: { id: destination.changeRequestId, operationId: destination.operationId },
      });
    } else if (destination.kind === "record") {
      router.push({ pathname: "/records/[id]", params: { id: destination.recordId } });
    }
    // `none`: the card does not offer a press at all, so there is nothing here.
  };

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
    <DrawerScaffold title="Inbox" refreshing={active.refreshing} onRefresh={active.refetch}>
      <View style={styles.segmentWrap}>
        <NativeSegmentedControl
          value={activeMode}
          options={modes.map((mode) => ({
            value: mode.key,
            label: mode.label,
            // Mentions shows its UNREAD count on every tab: it is a
            // notification and has to reach someone who is not looking for it.
            // The change-request tabs number only what the server counted —
            // absent when it cannot, since a number taken from one page reads
            // as a total and silently understates it.
            meta:
              mode.key === "mentions"
                ? mentionUnread || undefined
                : inbox.counts?.[mode.key as InboxMode],
          }))}
          onChange={setActiveMode}
        />
      </View>

      {active.loading ? (
        <NativeLoadingState
          label={showingMentions ? "Loading mentions" : "Loading change requests"}
        />
      ) : null}
      {active.error ? (
        <NativeErrorState message={active.error.message} onRetry={active.refetch} />
      ) : null}
      {!active.loading &&
      !active.error &&
      (showingMentions ? mentions.items.length === 0 : changeRequests.length === 0) ? (
        <NativeEmptyState title={emptyCopy[activeMode]} />
      ) : null}

      {showingMentions
        ? mentions.items.length > 0 && (
            <NativeSection title="Mentions" caption={`${mentions.items.length}`}>
              {mentions.items.map((item, index) => (
                <MentionCard
                  key={item.commentId}
                  item={item}
                  last={index === mentions.items.length - 1}
                  onPress={() => openMention(item)}
                />
              ))}
            </NativeSection>
          )
        : showGroups
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
      {active.hasMore ? (
        <View style={styles.loadMoreWrap}>
          <NativeActionBar>
            <Button
              label={active.loadingMore ? "Loading…" : "Load more"}
              variant="secondary"
              disabled={active.loadingMore}
              onPress={active.loadMore}
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
