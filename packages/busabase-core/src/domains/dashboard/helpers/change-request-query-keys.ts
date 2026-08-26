import type { QueryKey } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";

export const createChangeRequestQueryKeys = (orpc: BusabaseQueryUtils) => ({
  changeRequests: orpc.changeRequests.list.queryOptions({ input: {} }).queryKey as QueryKey,
  changeRequestsPaged: orpc.changeRequests.listPage.key() as QueryKey,
  inboxSnapshot: orpc.changeRequests.inboxSnapshot.key() as QueryKey,
  changeRequestCounts: orpc.changeRequests.counts.key() as QueryKey,
  changeRequestDetail: orpc.changeRequests.get.key() as QueryKey,
});
