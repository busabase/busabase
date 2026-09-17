import { useInfiniteQuery } from "@tanstack/react-query";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  FIRST_INBOX_PAGE,
  fetchInboxPage,
  type InboxClient,
  type InboxMode,
  type InboxPage,
  type InboxPageParam,
  inboxBadgeCounts,
  inboxModeFilter,
  nextInboxPageParam,
} from "../utils/inbox-paging";

/**
 * The Inbox's data, one server-filtered query per tab.
 *
 * Thin on purpose: every decision — what each tab asks the server for, how a
 * page is fetched, whether the counts can be trusted — lives in
 * `utils/inbox-paging`, where it is testable without a renderer.
 */
export function useInboxChangeRequests(mode: InboxMode) {
  const buda = useBusabaseOrpc();
  const filter = inboxModeFilter(mode);

  const query = useInfiniteQuery<InboxPage, Error, InboxPage[], unknown[], InboxPageParam>({
    queryKey: ["inbox", buda?.spaceScope ?? "no-connection", mode],
    enabled: buda !== null,
    initialPageParam: FIRST_INBOX_PAGE,
    queryFn: ({ pageParam }) => {
      if (!buda) throw new Error("Not connected");
      return fetchInboxPage(
        buda.client.changeRequests as unknown as InboxClient,
        filter,
        pageParam,
      );
    },
    getNextPageParam: nextInboxPageParam,
    select: (data) => data.pages,
  });

  const pages = query.data ?? [];

  return {
    changeRequests: pages.flatMap((page) => page.changeRequests),
    counts: inboxBadgeCounts(pages),
    error: query.error,
    hasMore: query.hasNextPage,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    refreshing: query.isRefetching,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch: () => void query.refetch(),
  };
}
