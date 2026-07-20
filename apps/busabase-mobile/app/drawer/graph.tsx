import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { ScrollView, useWindowDimensions } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { BaseGraph } from "~/components/busabase/BaseGraph";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeErrorState, NativeLoadingState } from "~/components/native-screen";

// Approximate height taken by: safe-area-top + NativeScreen header (title + padding)
// Adjust if the graph clips on particular devices.
const HEADER_OFFSET = 170;

// Minimum center-to-center spacing a node needs to stay legible (node diameter
// + label + breathing room) before the force layout starts overlapping nodes.
const MIN_NODE_SPACING = 92;

function GraphContent() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const buda = useBusabaseOrpc();
  const query = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );

  const bases = query.data ?? [];
  const screenHeight = Math.max(300, height - HEADER_OFFSET);

  // Below a handful of nodes the screen has plenty of room; past that, grow the
  // simulation canvas roughly with sqrt(n) so nodes get enough room to spread
  // instead of clamping into overlapping clusters at the screen edges. Users
  // pan the overflow via the horizontal ScrollView + the screen's own vertical
  // scroll (no gesture/zoom library needed for this).
  const { graphWidth, graphHeight } = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(bases.length)));
    const rows = Math.max(1, Math.ceil(bases.length / cols));
    return {
      graphWidth: Math.max(width, cols * MIN_NODE_SPACING),
      graphHeight: Math.max(screenHeight, rows * MIN_NODE_SPACING),
    };
  }, [bases.length, width, screenHeight]);

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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={graphWidth > width}
          scrollEnabled={graphWidth > width}
          contentContainerStyle={{ width: graphWidth, height: graphHeight }}
        >
          <BaseGraph
            bases={bases}
            width={graphWidth}
            height={graphHeight}
            onNodePress={handleNodePress}
          />
        </ScrollView>
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
