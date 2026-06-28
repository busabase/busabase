import type { BaseVO } from "busabase-core/types";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { useWindowDimensions } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { BaseGraph } from "~/components/busabase/BaseGraph";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { useNativeQuery } from "~/hooks/use-native-query";

// Approximate height taken by: safe-area-top + NativeScreen header (title + padding)
// Adjust if the graph clips on particular devices.
const HEADER_OFFSET = 170;

function GraphContent() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const client = useBusabaseClient();

  const load = useCallback((): Promise<BaseVO[]> => {
    return client?.bases.list() ?? Promise.resolve([]);
  }, [client]);
  const query = useNativeQuery(!!client, load);

  const graphHeight = Math.max(300, height - HEADER_OFFSET);

  const handleNodePress = useCallback(
    (slug: string) => {
      router.push({ pathname: "/base/[slug]", params: { slug } });
    },
    [router],
  );

  return (
    <DrawerScaffold title="Graph View">
      {query.loading ? <NativeLoadingState label="Loading bases…" /> : null}
      {query.error ? <NativeErrorState message={query.error} onRetry={query.refetch} /> : null}
      {!query.loading && !query.error ? (
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
