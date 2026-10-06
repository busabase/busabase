import { useMemo } from "react";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ActivityEventRow } from "~/domains/review/components/ActivityEventRow";
import { useInfiniteActivityFeed } from "~/domains/review/hooks/use-activity-feed";
import type { ActivityEvent } from "~/domains/review/types/activity-events";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";

const ACTIVITY_PAGE_SIZE = 25;

function ActivityContent() {
  const query = useInfiniteActivityFeed(ACTIVITY_PAGE_SIZE);

  const { today, earlier } = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const events = query.data?.pages.flatMap((page) => page.events) ?? [];
    return {
      today: events.filter((event) => new Date(event.timestamp) >= startOfDay),
      earlier: events.filter((event) => new Date(event.timestamp) < startOfDay),
    };
  }, [query.data]);

  const renderRow = (event: ActivityEvent, index: number, total: number) => (
    <ActivityEventRow key={event.id} event={event} last={index === total - 1} />
  );

  return (
    <DrawerScaffold
      title="Activity"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading ? <NativeLoadingState label="Loading activity" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && today.length === 0 && earlier.length === 0 ? (
        <NativeEmptyState title="No activity yet" />
      ) : null}
      {today.length > 0 ? (
        <NativeSection title="Today" caption={`${today.length}`}>
          {today.map((event, index) => renderRow(event, index, today.length))}
        </NativeSection>
      ) : null}
      {earlier.length > 0 ? (
        <NativeSection title="Earlier" caption={`${earlier.length}`}>
          {earlier.map((event, index) => renderRow(event, index, earlier.length))}
        </NativeSection>
      ) : null}
      {!query.isLoading && !query.error && query.hasNextPage ? (
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

export default function ActivityScreen() {
  return (
    <ConnectionGuard>
      <ActivityContent />
    </ConnectionGuard>
  );
}
