import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ActivityItemVO } from "busabase-contract/types";
import { isMissingRouteError } from "~/api/mobile-api-compat";
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

/**
 * One record's own history, newest first, a page at a time — the mobile side of
 * web's record Activity page (`activity.listForRecordPaged`).
 *
 * A server that predates that route answers NOT_FOUND; it still has the older
 * unpaged `activity.listForRecord`, so this falls back to one bounded page of it
 * rather than showing nothing. (NOT_FOUND here is ambiguous with "no such
 * record" — the fallback then fails too, and that error surfaces.)
 */
export function useInfiniteRecordActivity(recordId: string, pageSize: number) {
  const buda = useBusabaseOrpc();

  return useInfiniteQuery({
    queryKey: ["activity", "record", buda?.serverUrl, buda?.spaceScope, recordId, pageSize],
    queryFn:
      buda && recordId
        ? async ({ pageParam }) => {
            const toEvents = (items: ActivityItemVO[]) =>
              items
                .map(buildActivityEventFromItem)
                .filter((event): event is ActivityEvent => event !== null);
            try {
              const page = await buda.client.activity.listForRecordPaged({
                recordId,
                limit: pageSize,
                cursor: pageParam,
              });
              return { events: toEvents(page.items), nextCursor: page.nextCursor };
            } catch (caught) {
              if (pageParam !== undefined || !isMissingRouteError(caught)) throw caught;
              const items = await buda.client.activity.listForRecord({ recordId, limit: 100 });
              return { events: toEvents(items), nextCursor: null };
            }
          }
        : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
