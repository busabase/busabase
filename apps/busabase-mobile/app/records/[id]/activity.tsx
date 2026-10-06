import { skipToken, useQuery } from "@tanstack/react-query";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeInlineError,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ActivityEventRow } from "~/domains/review/components/ActivityEventRow";
import { useInfiniteRecordActivity } from "~/domains/review/hooks/use-activity-feed";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

/** Same page size as web's record Activity page. */
const RECORD_ACTIVITY_PAGE_SIZE = 50;

/**
 * A record's whole history, a page at a time — where the record screen's
 * bounded "Review history" preview leads. Mirrors web's
 * `/base/:slug/:recordId/activity`.
 */
function RecordActivityContent() {
  const params = useLocalSearchParams<{ id?: string }>();
  const recordId = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();

  // Same query (and cache entry) as the record screen this was opened from.
  const recordQuery = useQuery(
    buda && recordId
      ? buda.orpc.records.get.queryOptions({ input: { recordId } })
      : { queryKey: ["no-connection", "record", recordId], queryFn: skipToken },
  );
  const query = useInfiniteRecordActivity(recordId, RECORD_ACTIVITY_PAGE_SIZE);
  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() =>
        router.canGoBack()
          ? router.back()
          : router.replace({ pathname: "/records/[id]", params: { id: recordId } })
      }
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  return (
    <DrawerScaffold
      title="Activity"
      subtitle={recordQuery.data ? getRecordTitle(recordQuery.data) : undefined}
      headerLeading={headerLeading}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading ? <NativeLoadingState label="Loading activity" /> : null}
      {query.error && events.length === 0 ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && events.length === 0 ? (
        <NativeEmptyState title="No activity yet" />
      ) : null}
      {events.length > 0 ? (
        <NativeSection title="History" caption={`${events.length}`}>
          {events.map((event, index) => (
            <ActivityEventRow key={event.id} event={event} last={index === events.length - 1} />
          ))}
        </NativeSection>
      ) : null}
      {/* A failed NEXT page keeps what already loaded and retries just that page. */}
      {query.isFetchNextPageError ? (
        <NativeActionBar>
          <NativeInlineError message={query.error?.message ?? "Couldn't load older activity"} />
          <Button
            label="Retry"
            variant="secondary"
            fullWidth
            onPress={() => void query.fetchNextPage()}
          />
        </NativeActionBar>
      ) : query.hasNextPage ? (
        <NativeActionBar>
          <Button
            label="Load older activity"
            variant="secondary"
            loading={query.isFetchingNextPage}
            fullWidth
            onPress={() => void query.fetchNextPage()}
          />
        </NativeActionBar>
      ) : null}
    </DrawerScaffold>
  );
}

export default function RecordActivityScreen() {
  return (
    <ConnectionGuard>
      <RecordActivityContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
