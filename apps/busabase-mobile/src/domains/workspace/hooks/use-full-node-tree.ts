import { skipToken, useQuery } from "@tanstack/react-query";
import type { NodeVO } from "busabase-contract/types";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";

/**
 * The whole node tree, read only while a sheet that needs every folder is
 * open: Move (any folder is a destination) and Permissions (a private folder
 * anywhere above the node). The drawer itself loads root + two levels and
 * deeper folders on demand, so its tree can miss both. Same on-demand read
 * Cloud's permissions panel does. `loaded` is the drawer's tree, used until
 * the whole one arrives.
 */
export const useFullNodeTree = (enabled: boolean, loaded: NodeVO[]): NodeVO[] => {
  const buda = useBusabaseOrpc();
  const query = useQuery({
    ...(buda
      ? buda.orpc.nodes.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "nodes-full"], queryFn: skipToken }),
    enabled: enabled && !!buda,
  });
  return query.data ?? loaded;
};
