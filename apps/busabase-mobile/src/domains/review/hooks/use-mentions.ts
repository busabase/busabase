import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MentionInboxItemVO } from "busabase-contract/types";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";

const PAGE_SIZE = 50;

/**
 * The unread-mention count, for the tab badge.
 *
 * Fetched even while another tab is on screen, and deliberately so — this is
 * the one badge in this Inbox that is a NOTIFICATION rather than a summary of
 * what you are looking at. The change-request tabs only number the tab you
 * opened, because numbering the others would mean deriving them from a page
 * that was never fetched. "Someone named you" is different: it has to reach the
 * person without them going looking for it first.
 *
 * Asks for one row, not fifty: only `unreadCount` is read here.
 */
export function useMentionUnreadCount({ enabled = true }: { enabled?: boolean } = {}) {
  const buda = useBusabaseOrpc();

  const query = useQuery({
    queryKey: ["mentions-unread", buda?.spaceScope ?? "no-connection"],
    enabled: enabled && !!buda,
    queryFn: async () => {
      if (!buda) return 0;
      const page = await buda.client.comments.listMentions({ page: 1, pageSize: 1 });
      return page.unreadCount;
    },
  });

  return query.data ?? 0;
}

/** One page's worth of mentions, plus the actions a row offers. */
export function useMentions({ enabled }: { enabled: boolean }) {
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const scope = buda?.spaceScope ?? "no-connection";

  const query = useInfiniteQuery<
    { items: MentionInboxItemVO[]; total: number; unreadCount: number },
    Error,
    { items: MentionInboxItemVO[]; total: number; unreadCount: number }[],
    unknown[],
    number
  >({
    queryKey: ["mentions", scope],
    enabled: enabled && !!buda,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.comments.listMentions({ page: pageParam, pageSize: PAGE_SIZE });
    },
    // `total` is the whole set, so there is another page whenever what we have
    // seen so far falls short of it.
    getNextPageParam: (lastPage, allPages) =>
      allPages.reduce((sum, page) => sum + page.items.length, 0) < lastPage.total
        ? allPages.length + 1
        : undefined,
    select: (data) => data.pages,
  });

  const pages = query.data ?? [];

  const markRead = useMutation({
    mutationFn: async (commentId: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.comments.markMentionsRead({ commentId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mentions", scope] });
      void queryClient.invalidateQueries({ queryKey: ["mentions-unread", scope] });
    },
  });

  return {
    items: pages.flatMap((page) => page.items),
    unreadCount: pages[0]?.unreadCount ?? 0,
    error: query.error,
    hasMore: query.hasNextPage,
    loading: query.isLoading,
    loadingMore: query.isFetchingNextPage,
    refreshing: query.isRefetching,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch: () => void query.refetch(),
    /**
     * Stamped on open. Failure is swallowed on purpose: the person asked to see
     * the comment, and blocking that on a bookkeeping write — or showing them
     * an error about one — would be the wrong trade. The badge simply stays up
     * until the next successful mark.
     */
    markRead: (commentId: string) => markRead.mutate(commentId),
  };
}
