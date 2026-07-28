import { skipToken, useQuery } from "@tanstack/react-query";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { type ActivityEvent, buildActivityEvents } from "./activity-events";

/**
 * The Activity timeline, shared by the Activity screen and Home's "Recent
 * activity" preview so they hit ONE cache entry instead of two.
 *
 * Deliberately still the three-call merge (change requests + records + audit
 * events) mobile has always used — Home is not the place to swap the pipeline
 * over to the server-side `activity.listPaged` the web dashboard uses.
 */
export function useActivityFeed() {
  const buda = useBusabaseOrpc();

  return useQuery<ActivityEvent[]>({
    queryKey: buda
      ? ["activity", buda.orpc.changeRequests.list.key({})]
      : ["no-connection", "activity"],
    queryFn: buda
      ? async () => {
          const client = buda.client;
          const [changeRequestPage, recordPage, auditEvents] = await Promise.all([
            client.changeRequests.list({ limit: 100 }),
            client.records.list({ limit: 100 }),
            client.auditEvents.list({ limit: 100 }).catch(() => []),
          ]);
          return buildActivityEvents(
            changeRequestPage.changeRequests,
            recordPage.records,
            auditEvents,
          );
        }
      : skipToken,
  });
}
