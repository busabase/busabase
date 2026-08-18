import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { type ActivityEvent, buildActivityEventFromItem } from "../types/activity-events";

/**
 * The Activity timeline, shared by the Activity screen and Home's "Recent
 * activity" preview. The server merges the event sources before pagination, so
 * mobile never downloads the full change-request, record, and audit tables.
 */
export function useActivityFeed(limit: number) {
  const buda = useBusabaseOrpc();

  return useQuery<ActivityEvent[]>({
    queryKey: ["activity", "preview", buda?.serverUrl, buda?.spaceScope, limit],
    queryFn: buda
      ? async () => {
          const page = await buda.client.activity.listPaged({ limit });
          return page.items
            .map(buildActivityEventFromItem)
            .filter((event): event is ActivityEvent => event !== null);
        }
      : skipToken,
  });
}

export function useInfiniteActivityFeed(pageSize: number) {
  const buda = useBusabaseOrpc();

  return useInfiniteQuery({
    queryKey: ["activity", "paged", buda?.serverUrl, buda?.spaceScope, pageSize],
    queryFn: buda
      ? async ({ pageParam }) => {
          const page = await buda.client.activity.listPaged({
            cursor: pageParam,
            limit: pageSize,
          });
          return {
            events: page.items
              .map(buildActivityEventFromItem)
              .filter((event): event is ActivityEvent => event !== null),
            nextCursor: page.nextCursor,
          };
        }
      : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
