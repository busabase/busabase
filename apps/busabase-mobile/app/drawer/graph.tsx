import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { useWindowDimensions } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { BaseGraph } from "~/components/busabase/BaseGraph";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeErrorState, NativeLoadingState } from "~/components/native-screen";

// Approximate height taken by: safe-area-top + NativeScreen header (title + padding)
// Adjust if the graph clips on particular devices.
const HEADER_OFFSET = 170;

function GraphContent() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const buda = useBusabaseOrpc();
  const query = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );

  const graphHeight = Math.max(300, height - HEADER_OFFSET);

  const handleNodePress = useCallback(
    (slug: string) => {
      router.push({ pathname: "/base/[slug]", params: { slug } });
    },
    [router],
  );

  return (
    <DrawerScaffold title="Graph View">
      {query.isLoading ? <NativeLoadingState label="Loading bases…" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error ? (
        <BaseGraph
          bases={query.data ?? []}
          width={width}
          height={graphHeight}
          onNodePress={handleNodePress}
        />
      ) : null}
    </DrawerScaffold>
  );
}

export default function GraphScreen() {
  return (
    <ConnectionGuard>
      <GraphContent />
    </ConnectionGuard>
  );
}
