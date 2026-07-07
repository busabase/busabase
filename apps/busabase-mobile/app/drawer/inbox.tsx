import { skipToken, useQuery } from "@tanstack/react-query";
import type { ChangeRequestVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ChangeRequestCard } from "~/components/busabase/ChangeRequestCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
  NativeSegmentedControl,
} from "~/components/native-screen";

// Match both the web/local editor and change requests created from this mobile app.
const LOCAL_AUTHORS = new Set(["local-editor", "mobile-editor"]);

const modes = [
  { key: "review", label: "Review" },
  { key: "mine", label: "Mine" },
  { key: "done", label: "Done" },
] as const;

type InboxMode = (typeof modes)[number]["key"];

const matchesMode = (changeRequest: ChangeRequestVO, mode: InboxMode): boolean => {
  switch (mode) {
    case "review":
      return changeRequest.status === "in_review" || changeRequest.status === "approved";
    case "mine":
      return LOCAL_AUTHORS.has(changeRequest.submittedBy);
    case "done":
      return ["merged", "rejected"].includes(changeRequest.status);
  }
};

const emptyCopy: Record<InboxMode, { title: string; description: string }> = {
  review: {
    title: "Inbox is clear",
    description: "New change requests submitted to the connected Busabase server will appear here.",
  },
  mine: {
    title: "Nothing created yet",
    description: "Change requests you submit from this device show up here.",
  },
  done: {
    title: "No completed reviews",
    description: "Merged and rejected change requests will appear here.",
  },
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
  const buda = useBusabaseOrpc();
  const [activeMode, setActiveMode] = useState<InboxMode>("review");
  const query = useQuery(
    buda
      ? buda.orpc.changeRequests.list.queryOptions({ input: { limit: 100 } })
      : { queryKey: ["no-connection", "changeRequests", "list"], queryFn: skipToken },
  );

  // Refresh whenever the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void query.refetch();
      }
    });
    return () => subscription.remove();
  }, [query.refetch]);

  const counts = useMemo(() => {
    const next: Record<InboxMode, number> = {
      review: 0,
      mine: 0,
      done: 0,
    };
    for (const changeRequest of query.data ?? []) {
      for (const mode of modes) {
        if (matchesMode(changeRequest, mode.key)) {
          next[mode.key] += 1;
        }
      }
    }
    return next;
  }, [query.data]);

  const visible = useMemo(
    () => (query.data ?? []).filter((changeRequest) => matchesMode(changeRequest, activeMode)),
    [query.data, activeMode],
  );

  const groups = useMemo(() => {
    if (activeMode === "mine") {
      const isOpen = (changeRequest: ChangeRequestVO) =>
        changeRequest.status === "in_review" || changeRequest.status === "approved";
      return [
        { title: "Open", items: visible.filter(isOpen) },
        { title: "Closed", items: visible.filter((cr) => !isOpen(cr)) },
      ].filter((group) => group.items.length > 0);
    }
    if (activeMode === "done") {
      return [
        { title: "Merged", items: visible.filter((cr) => cr.status === "merged") },
        { title: "Rejected", items: visible.filter((cr) => cr.status === "rejected") },
      ].filter((group) => group.items.length > 0);
    }
    if (activeMode === "review") {
      const needsReview = visible.filter((cr) => cr.status === "in_review");
      return [
        { title: "Ready to merge", items: visible.filter((cr) => cr.status === "approved") },
        { title: "New", items: needsReview.filter(isRecentChangeRequest) },
        { title: "Earlier", items: needsReview.filter((cr) => !isRecentChangeRequest(cr)) },
      ].filter((group) => group.items.length > 0);
    }
    return null;
  }, [activeMode, visible]);

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
    <DrawerScaffold
      title="Inbox"
      subtitle="Change requests from connected agents"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <View style={styles.segmentWrap}>
        <NativeSegmentedControl
          value={activeMode}
          options={modes.map((mode) => ({
            value: mode.key,
            label: mode.label,
            meta: counts[mode.key],
          }))}
          onChange={setActiveMode}
        />
      </View>

      {query.isLoading ? <NativeLoadingState label="Loading change requests" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && visible.length === 0 ? (
        <NativeEmptyState
          title={emptyCopy[activeMode].title}
          description={emptyCopy[activeMode].description}
        />
      ) : null}
      {showGroups
        ? (groups ?? []).map(renderGroup)
        : visible.length > 0 && (
            <NativeSection title={activeLabel} caption={`${visible.length}`}>
              {visible.map((changeRequest, index) => (
                <ChangeRequestCard
                  key={changeRequest.id}
                  changeRequest={changeRequest}
                  last={index === visible.length - 1}
                  onPress={() => openChangeRequest(changeRequest)}
                />
              ))}
            </NativeSection>
          )}
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
});
